const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const bodyParser = require("body-parser");
const exphbs = require("express-handlebars");
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");
const connectionString = "mongodb+srv://turquoisecarlee:lIgnMZtRdrKPIMjN@cluster0.qyp4f.mongodb.net/?retryWrites=true&w=majority";
const uuid = require("uuid");
const cookieParser = require("cookie-parser");
const { marked } = require("marked");
const fetch = require("node-fetch");
const pm2 = require('pm2');

app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// Explicitly set MIME types for common static files
express.static.mime.define({'text/css': ['css']});
express.static.mime.define({'application/javascript': ['js']});
express.static.mime.define({'application/javascript': ['mjs']});  // For ES modules
express.static.mime.define({'image/jpeg': ['jpg', 'jpeg']});
express.static.mime.define({'image/png': ['png']});
express.static.mime.define({'image/gif': ['gif']});

// Get absolute path to public directory
const publicPath = path.resolve(__dirname, "public");
console.log('Public directory absolute path:', publicPath);

// Verify public directory exists and is accessible
try {
  const publicStats = fs.statSync(publicPath);
  console.log('Public directory exists:', publicStats.isDirectory());
  console.log('Public directory permissions:', {
    readable: Boolean(publicStats.mode & fs.constants.R_OK),
    writable: Boolean(publicStats.mode & fs.constants.W_OK),
    executable: Boolean(publicStats.mode & fs.constants.X_OK)
  });
} catch (error) {
  console.error('Error accessing public directory:', error);
}

// Configure static file serving options
const staticOptions = {
  dotfiles: 'ignore',
  etag: true,
  extensions: false,
  fallthrough: true,
  immutable: true,
  index: false,
  lastModified: true,
  maxAge: '1y',
  redirect: true,
  setHeaders: (res, path, stat) => {
    // Set proper security headers
    res.set('X-Content-Type-Options', 'nosniff');
    
    // Set proper MIME types
    if (path.endsWith('.css')) {
      res.set('Content-Type', 'text/css; charset=utf-8');
    } else if (path.endsWith('.js')) {
      res.set('Content-Type', 'application/javascript; charset=utf-8');
    }
    
    // Set caching headers
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
};

// Serve static files before route handlers
app.use(express.static(publicPath, staticOptions));
app.use(express.static(path.join(process.cwd(), 'public'), staticOptions));

// Parse request bodies
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(cookieParser());

// Root route handler - should be after static middleware but before 404 handler
app.get("/", (req, res) => {
  console.log('Handling root route');
  res.render("index", {
    layout: "main",
    title: "Airbrush Dashboard"
  });
});

// Other route handlers
app.get("/pricing", (req, res) => {
  res.render("pricing", {
    layout: "main",
    title: "Pricing - Airbrush Dashboard"
  });
});

app.get("/404", (req, res) => {
  res.render("404", {
    layout: "main",
    title: "404 - Page Not Found"
  });
});

app.get("/faq", (req, res) => {
  res.render("faq", {
    layout: "main",
    title: "FAQ - Airbrush Dashboard"
  });
});

// Cache configuration
const routeCache = {
  categories: null,
  lastFetch: null,
  isRefreshing: false,
  cacheTimeout: 5 * 60 * 1000, // 5 minutes
  minRefreshInterval: 10 * 1000 // 10 seconds minimum between refreshes
};


const OPENAI_API_KEY = "open_ai_key_here";
const apiUrl = "https://api.openai.com/v1/chat/completions";

app.engine(
  "hbs",
  exphbs({
    defaultLayout: "main",
    extname: ".hbs",
    partialsDir: path.join(__dirname, "views", "partials"),
    layoutsDir: path.join(__dirname, "views", "layouts"),
    helpers: {
      ifCond: function (v1, operator, v2, options) {
        switch (operator) {
          case "==":
            return v1 == v2 ? options.fn(this) : options.inverse(this);
          case "===":
            return v1 === v2 ? options.fn(this) : options.inverse(this);
          case "!=":
            return v1 != v2 ? options.fn(this) : options.inverse(this);
          case "!==":
            return v1 !== v2 ? options.fn(this) : options.inverse(this);
          case "<":
            return v1 < v2 ? options.fn(this) : options.inverse(this);
          case "<=":
            return v1 <= v2 ? options.fn(this) : options.inverse(this);
          case ">":
            return v1 > v2 ? options.fn(this) : options.inverse(this);
          case ">=":
            return v1 >= v2 ? options.fn(this) : options.inverse(this);
          case "&&":
            return v1 && v2 ? options.fn(this) : options.inverse(this);
          case "||":
            return v1 || v2 ? options.fn(this) : options.inverse(this);
          default:
            return options.inverse(this);
        }
      },
      encodeURIComponent: function(str) {
        return encodeURIComponent(str);
      }
    },
  })
);

const sitemapPath = path.join(__dirname, "views", "sitemap.hbs");
const generatedPagesPath = path.join(__dirname, "views", "generated-pages");
let sitemapContent = fs.readFileSync(sitemapPath, "utf-8");
const generatedFiles = fs.readdirSync(generatedPagesPath);

// Function to fetch categories from API
async function fetchCategories() {
  try {
    const response = await fetch('https://airbrush-admin-backend.onrender.com/api/categories');
    if (!response.ok) {
      throw new Error(`Failed to fetch categories: ${response.status} ${response.statusText}`);
    }
    const categories = await response.json();
    console.log('Fetched categories');
    return categories;
  } catch (error) {
    console.error('Error fetching categories:', error);
    return [];
  }
}

// Function to fetch free generators content
async function fetchFreeGenerators() {
  try {
    const response = await fetch('https://airbrush-admin-backend.onrender.com/api/free-generators');
    if (!response.ok) {
      throw new Error(`Failed to fetch free generators: ${response.status} ${response.statusText}`);
    }
    const generators = await response.json();
    console.log('Full generators response:', JSON.stringify(generators, null, 2));
    return generators.data;
  } catch (error) {
    console.error('Error fetching free generators:', error);
    return [];
  }
}

MongoClient.connect(connectionString, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
}, async (err, client) => {
  if (err) {
    console.error("MongoDB Connection Error:", err);
    process.exit(1);
  }
  console.log("Connected to Database");

  const db = client.db("ai4chat");
  const rootCollection = db.collection("root-collection");
  const blogCollection = db.collection("blog-collection");
  const gptCollection = db.collection("gpt-collection");
  const generatorCollection = db.collection("generator-collection");
  const characterCollection = db.collection("character-collection");
  const modelsCollection = db.collection("models");
  const imageModelsCollection = db.collection("image-models");
  const apiFeatureCollection = db.collection("api-feature-collection");


  app.post("/generate-response", async (req, res) => {
    const conversation = req.body.messages;
    const assistantMessage = await aiChat(conversation);
    res.json({ message: marked(assistantMessage) });
  });

  function getTotalWordCount(conversation) {
    let totalWordCount = 0;
    for (let i = 0; i < conversation.length; i++) {
      const message = conversation[i];
      const messageContent = message.content;
      const words = messageContent.split(/\s+/);
      const wordCount = words.length;
      totalWordCount += wordCount;
    }
    return totalWordCount;
  }

  async function truncateConversationToWordLimit(conversation, wordLimit) {
    try {
      if (conversation.length === 1) {
        const singleMessage = conversation[0];
        if (getTotalWordCount([singleMessage]) > wordLimit) {
          conversation[0] = await truncateMessageToWordLimit(
            singleMessage,
            wordLimit
          );
        }
      } else {
        let totalWordCount = getTotalWordCount(conversation);
        while (totalWordCount > wordLimit && conversation.length > 0) {
          conversation.shift();
          totalWordCount = getTotalWordCount(conversation);
        }
      }
      return conversation;
    } catch (error) {
      console.error("An error occurred:", error.message);
      throw error;
    }
  }

  async function waitForMeToFinish(delay) {
    let datetime1 = new Date().getTime();
    let datetime2 = datetime1 + delay;
    while (datetime1 < datetime2) {
      datetime1 = new Date().getTime();
    }
  }

  async function aiChat(conversation) {
    let assistantMessage;
    conversation = await truncateConversationToWordLimit(conversation, 3500);

    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer 237e5cfcd2474cb7bf28c076d1054072",
      },
      body: JSON.stringify({
        model: "GPT 4o Mini",
        messages: conversation,
      }),
    };

    const maxRetries = 5;
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const response = await fetch(
          "https://app.ai4chat.co/api/v1/chat/completions",
          requestOptions
        );
        const data = await response.json();
        assistantMessage = data.choices[0].message.content;
        console.log("Assistant's response:", assistantMessage);
        return assistantMessage;
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} failed: ${error.message}`);

        if (attempts >= maxRetries) {
          console.error(
            "Function calling failed after multiple attempts:",
            error
          );
          assistantMessage = await chatgpt3(conversation, "gpt-4o-mini");
          console.log("Assistant's response:", assistantMessage);
          return assistantMessage;
        } else {
          await waitForMeToFinish(5000);
        }
      }
    }
  }

  app.get("/free-tool", (req, res) => {
    res.render("free-tool");
  });

  app.get("/free-tool-2", (req, res) => {
    res.render("free-tool-2");
  });

  app.get("/privacy-policy", (req, res) => {
    res.render("privacy-policy");
  });

  app.get("/terms-of-service", (req, res) => {
    res.render("terms-of-service");
  });

  app.get("/blog", async (req, res) => {
    try {
      res.render('allBlog', {
        layout: 'main',
        section: { title: 'Blog', description: 'Blog' }
      });
    } catch (error) {
      console.error("Error fetching blog articles:", error);
      res.redirect("/error-page");
    }
  });

  app.get("/pages/:url", async (req, res) => {
    try {
      const generatorPage = await fetchFreeGenerators();
      
      // Check if generatorPage is an array and find the matching page
      const page = Array.isArray(generatorPage) 
        ? generatorPage.find(p => p.url === req.params.url)
        : null;
        
      if (!page) {
        console.log('No matching page found for URL:', req.params.url);
        return res.redirect("/404");
      }

      // Sanitize the page content to prevent script errors
      if (page.content) {
        // Remove any script tags from content
        page.content = page.content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      }

      res.render("generator-page", {
        generatorPage: page,
        section: { title: "Free Tools", description: "Free Tools" },
      });
    } catch (error) {
      console.error("Error fetching generator page:", error);
      res.redirect("/404");
    }
  });

  app.get("/blog/:title/:id", async (req, res) => {
    try {
      res.render("blog", {
        layout: "main",
        section: { title: "Blog", description: "Blog" },
      });
    } catch (error) {
      console.error("Error fetching blog article or related articles:", error);
      res.redirect("/error-page");
    }
  });

  app.get("/sitemap.xml", async (req, res) => {
    try {
      const pages = await rootCollection.find({}).toArray();
      const articles = await blogCollection.find({}).toArray();
      const gpts = await gptCollection.find({}).toArray();
      const characters = await characterCollection.find({}).toArray();
      const generatorPage = await generatorCollection.find({}).toArray();
      res.type("application/xml");
      res.render("sitemap", {
        pages,
        articles,
        gpts,
        characters,
        generatorPage,
      });
    } catch (error) {
      console.error("Error fetching pages:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  app.get("/bulk-create-image-pages", (req, res) => {
    res.render("bulk-create-image-pages");
  });

  // Authentication middleware
const checkAuth = (req, res, next) => {
  // Check if path is a protected route
  if (req.path === '/dashboard' || req.path === '/new-category') {
    // Check for token in cookies
    const token = req.cookies.authToken;
    if (!token) {
      return res.redirect('/');
    }
  }
  
  return next();
};

// Apply auth middleware to all routes except auth routes
app.use(checkAuth);

// View routes
app.get('/admin/login/secret', (req, res) => {
  res.render('auth', { layout: false });
});

// Dashboard route
app.get('/dashboard', (req, res) => {
  res.render('adminIndex', { 
    layout: 'adminMain',
    partialName: 'placeholder',
    title: 'Admin Dashboard',
    activeMenu: 'dashboard',
    section: { 
      title: 'Dashboard', 
      description: 'Welcome to your admin dashboard' 
    }
  });
});

app.get('/hero-section', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'hero-section',
    title: 'Hero Section',
    activeMenu: 'hero-section',
    section: { title: 'Hero section', description: 'Studio Ghibli is amazing!' }
  });
});

app.get('/edit-category', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'edit-category',
    title: 'Edit Category',
    section: { title: 'Edit Category', description: 'Edit Category' }
  });
});

app.get('/text-to-anything', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'text-to-anything',
    title: 'Text to Anything',
    section: { title: 'Text to Anything', description: 'Text to Anything' }
  });
});

app.get('/blogs', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'blogs',
    title: 'Blogs',
    section: { title: 'Blogs', description: 'Blogs' }
  });
});

app.get('/transform-grid', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'transform-grid',
    title: 'Transform Grid',
    section: { title: 'Transform Grid', description: 'Transform Grid' }
  });
});

app.get('/new-category', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'new-category',
    title: 'New Category',
    section: { title: 'New Category', description: 'New Category' }
  });
});

app.get('/why-use-tool', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'why-use-tool',
    section: { title: 'Why use the tool', description: 'Why use the tool section' }
  });
});

app.get('/images-gallery', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'image-gallery',
    section: { title: 'Image Gallery', description: 'Gallery of images' }
  });
});

app.get('/category-video', (req, res) => {
  res.render('adminIndex', {
    layout: 'adminMain',
    partialName: 'category-video',
    section: { title: 'Category Video', description: 'Category Video' }
  });
});


  function slugify(keyword) {
    return keyword
      .toLowerCase() // Convert to lowercase
      .replace(/\s+/g, "-") // Replace spaces with hyphens
      .replace(/[^\w\-]+/g, "") // Remove any non-word characters
      .replace(/\-\-+/g, "-") // Replace multiple hyphens with a single hyphen
      .trim(); // Remove any leading or trailing hyphens
  }

  app.post("/generate-page", async (req, res) => {
    const { keywords } = req.body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: "Invalid keywords input." });
    }

    try {
      const urls = await Promise.all(
        keywords.map(async (keyword) => {
          const slug = slugify(keyword);

          // Single conversation with all the required prompts
          const conversation1 = [
            {
              role: "user",
              content: `Generate an appropriate title for the web article having keywords: ${keyword}`,
            },
          ];
          const conversation2 = [
            {
              role: "user",
              content: `Generate a short-paragraphed content of about 4-6 lines based on keywords: ${keyword}`,
            },
          ];
          const conversation3 = [
            {
              role: "user",
              content: `Generate short-paragraphed content of about 4-6 lines about features based on keywords: ${keyword}`,
            },
          ];
          const conversation4 = [
            {
              role: "user",
              content: `Generate short-paragraphed content of about 4-6 lines about how to use based on keywords: ${keyword}`,
            },
          ];
          const conversation5 = [
            {
              role: "user",
              content: `Generate short-paragrpahed content of about 4-6 lines about best practices for keywords: ${keyword}`,
            },
          ];

          const response1 = await chatgpt3(conversation1, "gpt-4");
          const response2 = await chatgpt3(conversation2, "gpt-4");
          const response3 = await chatgpt3(conversation3, "gpt-4");
          const response4 = await chatgpt3(conversation4, "gpt-4");
          const response5 = await chatgpt3(conversation5, "gpt-4");

          const pageTitle = response1.choices[0].message.content;
          const content = response2.choices[0].message.content;
          const featuresContent = response3.choices[0].message.content;
          const howToUseContent = response4.choices[0].message.content;
          const bestPracticesContent = response5.choices[0].message.content;

          console.log(pageTitle);
          console.log(content);
          console.log(featuresContent);
          console.log(howToUseContent);
          console.log(bestPracticesContent);
          // const { pageTitle, content, featuresContent, howToUseContent, bestPracticesContent } = data;

          // Render content dynamically using a pre-saved .hbs template
          const templatePath = path.join(__dirname, "views", "template.hbs");
          const templateContent = fs.readFileSync(templatePath, "utf-8");
          const hbs = exphbs.create({});
		 const pageContent = hbs.handlebars.compile(templateContent)({
		  keyword,
		  pageTitle,
		  content,
		  featuresContent,
		  howToUseContent,
		  bestPracticesContent,
		});

          const pagePath = path.join(
            __dirname,
            "views",
            "generated-pages",
            `${slug}.hbs`
          );
          fs.writeFileSync(pagePath, pageContent);
          updateSitemap(`${slug}.hbs`);
          return `/${slug}`;
        })
      );
      res.json({ message: "Pages generated successfully!", urls });
    } catch (error) {
      console.error("Error generating page:", error);
      res.status(500).json({ error: "Failed to generate page content." });
    }
  });

  // app.get("/:slug", async (req, res) => {
  //   const { slug } = req.params;

  //   try {
  //     const blogArticle = await blogCollection.findOne({ url: slug });
  //     if (blogArticle) {
  //       // Redirect to the new blog URL
  //       return res.redirect(301, `/blog/${slug}`);
  //     }

  //     // Check in pages collection
  //     const generatorPage = await generatorCollection.findOne({ url: slug });
  //     if (generatorPage) {
  //       // Redirect to the new page URL
  //       return res.redirect(301, `/pages/${slug}`);
  //     }

  //     const filePath = path.join(
  //       __dirname,
  //       "views",
  //       "generated-pages",
  //       `${slug}.hbs`
  //     );
  //     if (fs.existsSync(filePath)) {
  //       return res.render(path.join("generated-pages", slug));
  //     }

  //     res.redirect("/404");
  //   } catch (error) {
  //     console.error("Error handling request:", error);
  //     res.status(500).send("Internal server error.");
  //   }
  // });

  function updateSitemap(fileName) {
    const generatedPagesPath = path.join(__dirname, "views", "generated-pages");
    const generatedFiles = fs.readdirSync(generatedPagesPath);

    let sitemapContent = fs.readFileSync(sitemapPath, "utf-8");

    const newUrls = generatedFiles
      .filter((file) => file.match(fileName))
      .map((file) => {
        const fileUrl = path.basename(file, ".hbs");
        return `
        <url>
          <loc>https://www.airbrush.ai/${fileUrl}</loc>
          <priority>0.80</priority>
          </url>`;
      })
      .join("\n");

    // Append the new URLs before the closing </urlset> tag
    if (sitemapContent.includes("</urlset>")) {
      sitemapContent = sitemapContent.replace(
        "</urlset>",
        `${newUrls}\n</urlset>`
      );
    } else {
      console.error("Invalid sitemap format: missing </urlset> tag.");
      return;
    }

    // Overwrite the original sitemap.hbs file with the updated content
    fs.writeFileSync(sitemapPath, sitemapContent, "utf-8");
    console.log("Sitemap updated successfully!");
  }

  // Function to call OpenAI API and generate content
  async function chatgpt3(conversation, aiengine) {
    const model = aiengine === "gpt-4" ? "gpt-4" : "gpt-3.5-turbo";
    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        messages: conversation,
      }),
    };

    const response = await fetch(apiUrl, requestOptions);
    const data = await response.json();
    console.log(data);
    return data;
  }

  

  // Add route update endpoint
  app.post("/api/update-routes", async (req, res) => {
    try {
      const result = await updateRoutes();
      res.json(result);
    } catch (error) {
      console.error('Error updating routes:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/:slug', async (req, res) => {
    const { slug } = req.params;
    
    try {
      // Check if the slug matches any category
      const categories = await fetchCategories();
      const matchedCategory = categories.find(cat => cat.slug === slug && cat.isActive);
      
      if (matchedCategory) {
        // If category exists and is active, render the template
        res.render('3d-image', {
          category: matchedCategory,
          categoryId: matchedCategory._id,
        });
      } else {
        // If no matching category found, redirect to 404
        res.redirect('/404');
      }
    } catch (error) {
      console.error('Error handling dynamic route:', error);
      res.redirect('/404');
    }
  }); 

  app.get("/blog/:id", async (req, res) => {
    try {
      res.render("blogPost", {
        layout: "main",
        section: { title: "Blog", description: "Blog Post" }
      });
    } catch (error) {
      console.error("Error fetching blog article:", error);
    }
  });

  app.all("*", (req, res) => {
    res.redirect("/404");
  });

  function ValidateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // return emailRegex.test(email);
  }
});

app.get("/api/image/generate", async (req, res) => {
  const { prompt, aspect_ratio: aspectRatio } = req.query;

  if (!prompt || !aspectRatio) {
    return res
      .status(400)
      .json({ error: "Missing prompt or aspect_ratio parameter" });
  }

  try {
    const apiUrl = `https://1yjs1yldj7.execute-api.us-east-1.amazonaws.com/default/ai_image?prompt=${encodeURIComponent(
      prompt
    )}&aspect_ratio=${aspectRatio}&link=${encodeURIComponent(
      "writecream.com"
    )}`;
    console.log("Requesting:", apiUrl); // Debugging URL

    const response = await fetch(apiUrl);

    if (!response.ok) {
      // Handle non-200 responses
      const errorText = await response.text();
      console.error("API Error:", errorText);
      return res
        .status(response.status)
        .json({ error: "Error from AI image API", details: errorText });
    }

    const imageDetails = await response.json();
    console.log("Response from API:", imageDetails);

    if (!imageDetails.image_link) {
      // Validate the presence of the image link
      return res
        .status(500)
        .json({ error: "No image_link in response", details: imageDetails });
    }

    res.json(imageDetails);
  } catch (error) {
    console.error("Error generating image:", error.message);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
});

let server;
// add comment
function startServer() {
  const PORT = process.env.PORT || 8000;
  server = app.listen(PORT, '0.0.0.0', function () {
    console.log(`Server listening on port ${PORT}...`);
  }).on('error', function(err) {
    console.error('Server failed to start:', err);
  });
}

startServer();

