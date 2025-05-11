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

// Serve static files - updated configuration
app.use(express.static(path.join(__dirname, "public")));
app.use("/js", express.static(path.join(__dirname, "public/js")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/images", express.static(path.join(__dirname, "public/images")));
app.use("/fonts", express.static(path.join(__dirname, "public/fonts")));
app.use("/videos", express.static(path.join(__dirname, "public/videos")));
app.use("/gallery", express.static(path.join(__dirname, "public/gallery")));

// Set cache headers for static files
app.use((req, res, next) => {
  if (req.url.match(/\.(css|js|jpg|jpeg|png|gif|ico)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
  }
  next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(cookieParser());

// Cache configuration
const routeCache = {
  categories: null,
  lastFetch: null,
  isRefreshing: false,
  cacheTimeout: 5 * 60 * 1000, // 5 minutes
  minRefreshInterval: 10 * 1000 // 10 seconds minimum between refreshes
};

// Middleware to refresh dynamic routes with caching and rate limiting
app.use(async (req, res, next) => {
  try {
    const now = Date.now();
    
    // Skip refresh if:
    // 1. Cache is valid (within timeout)
    // 2. Another refresh is in progress
    // 3. Last refresh was too recent (rate limiting)
    if (
      routeCache.categories && 
      routeCache.lastFetch && 
      (now - routeCache.lastFetch < routeCache.cacheTimeout) &&
      !routeCache.isRefreshing &&
      (now - routeCache.lastFetch < routeCache.minRefreshInterval)
    ) {
      return next();
    }

    // Prevent concurrent refreshes
    if (!routeCache.isRefreshing) {
      routeCache.isRefreshing = true;
      
      try {
        await initializeDynamicRoutes(app);
        updateRoutes();

        
        // Update cache
        routeCache.lastFetch = now;
        routeCache.categories = await fetchCategories();
      } finally {
        routeCache.isRefreshing = false;
      }
    }
    
    next();
  } catch (error) {
    console.error('Error in route refresh middleware:', error);
    // Continue to next middleware even if refresh fails
    next();
  }
});

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

// Initialize dynamic routes based on categories
async function initializeDynamicRoutes(app) {
  try {
    const categories = await fetchCategories();
    
    // Create a route for each category using its slug
    categories.forEach(category => {
      if (category.slug && category.isActive) {
        console.log(`Creating route for category: /${category.slug}`);
        
        // Convert slug to camelCase for the window object key
        // Example: "3d-image" -> "3dImage", "ghibli-style" -> "ghibliStyle"
        const camelCaseKey = category.slug.replace(/-([a-z])/g, (match, letter) => {
          return letter.toUpperCase();
        });
        
        app.get(`/${category.slug}`, (req, res) => {
          // Pass the category data to the template
          res.render('3d-image', { 
            category: category,
            categoryId: category._id,
          });
        });
      }
    });
    
    console.log('Dynamic routes initialized successfully');
  } catch (error) {
    console.error('Failed to initialize dynamic routes:', error);
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

  // Initialize dynamic routes after database connection
  await initializeDynamicRoutes(app);

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

  app.get("/pricing", (req, res) => {
    res.render("pricing");
  });

  app.get("/", (req, res) => {
    res.render("index");
  });

  // app.get("/3d-image", (req, res) => {
  //   // Get the 3D category ID - this would ideally come from your database or API
  //   // We're hardcoding it here as a fallback
  //   const categoryId = '6804931c39cff059c0655fd6'; // 3D category ID
  //   res.render("3d-image", {
  //     categoryId: categoryId,
  //     // Add script tag to expose category ID to client-side JavaScript
  //     categoryScript: `<script>
  //       window.airbrush3dImage = "${categoryId}";
  //       console.log("Category ID for 3D:", window.airbrush3dImage);
  //     </script>`
  //   });
  // });

  // app.get("/ghibli-image", (req, res) => {
  //   // Get the Ghibli category ID - this would ideally come from your database or API
  //   // We're hardcoding it here as a fallback
  //   const categoryId = '68054404386a5fc127d44b4a'; // Ghibli category ID
  //   res.render("ghibli", {
  //     categoryId: categoryId,
  //     // Add script tag to expose category ID to client-side JavaScript
  //     categoryScript: `<script>
  //       window.airbrushghibli = "${categoryId}";
  //       console.log("Category ID for Ghibli:", window.airbrushghibli);
  //     </script>`
  //   });
  // });


  app.get("/404", (req, res) => {
    res.render("404");
  });

  app.get("/faq", (req, res) => {
    res.render("faq");
  });

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

  app.get("/lifetime-deal", (req, res) => {
    res.render("lifetime-deal");
  });

  app.get("/blog", async (req, res) => {
    try {
      const articles = await blogCollection.find({}).toArray();
      articles.forEach((article) => {
        article.date = article.date.toISOString().split("T")[0];
      });
      res.render("blog", { articles: [...articles].reverse() });
    } catch (error) {
      console.error("Error fetching blog articles:", error);
      res.redirect("/error-page");
    }
  });

  app.get("/pages/:url", async (req, res) => {
    try {
      const generatorPage = await generatorCollection.findOne({
        url: req.params.url,
      });
      if (!generatorPage) {
        return res.redirect("/404");
      }
      res.render("generator-page", {
        generatorPage: generatorPage,
      });
    } catch (error) {
      console.error("Error fetching blog article or related articles:", error);
      res.redirect("/error-page");
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
  // Skip auth check for login/signup routes
  if (req.path === '/admin/login/secret' || req.path === '/auth') {
    return next();
  }
  
  // Check for token in cookies
  const token = req.cookies.authToken;
  if (!token) {
    return res.redirect('/');
  }
  
  next();
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

  app.get("/:slug", async (req, res) => {
    const { slug } = req.params;

    try {
      const blogArticle = await blogCollection.findOne({ url: slug });
      if (blogArticle) {
        // Redirect to the new blog URL
        return res.redirect(301, `/blog/${slug}`);
      }

      // Check in pages collection
      const generatorPage = await generatorCollection.findOne({ url: slug });
      if (generatorPage) {
        // Redirect to the new page URL
        return res.redirect(301, `/pages/${slug}`);
      }

      const filePath = path.join(
        __dirname,
        "views",
        "generated-pages",
        `${slug}.hbs`
      );
      if (fs.existsSync(filePath)) {
        return res.render(path.join("generated-pages", slug));
      }

      res.redirect("/404");
    } catch (error) {
      console.error("Error handling request:", error);
      res.status(500).send("Internal server error.");
    }
  });

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

  app.get("/blog/:url", (req, res) => {
    const newUrl = `/${req.params.url}`;
    res.redirect(301, newUrl);
  });

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

function startServer() {
  const PORT = process.env.PORT || 8000;
  server = app.listen(PORT, '0.0.0.0', function () {
    console.log(`Server listening on port ${PORT}...`);
  }).on('error', function(err) {
    console.error('Server failed to start:', err);
  });
}

// Function to restart the server using PM2
async function restartServer() {
  console.log('Restarting server');
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        console.error(err);
        reject(err);
        return;
      }

      pm2.restart('server', (err) => {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          console.log('Server restarted successfully');
          resolve();
        }
        pm2.disconnect();
      });
    });
  });
}

// Modify your route update function
async function updateRoutes() {
  try {
    await initializeDynamicRoutes(app);
    await restartServer();
    return { success: true, message: 'Routes updated and server restarted' };
  } catch (error) {
    console.error('Error updating routes:', error);
    return { success: false, message: error.message };
  }
}

// Export the updateRoutes function
module.exports = { updateRoutes };

startServer();

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (server) {
    server.close(() => {
      console.log('Server closed due to uncaught exception');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (server) {
    server.close(() => {
      console.log('Server closed due to unhandled rejection');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});