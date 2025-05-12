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

// Add request logging middleware before static file handling
app.use((req, res, next) => {
  console.log('\nIncoming request:');
  console.log('URL:', req.url);
  console.log('Path:', req.path);
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  next();
});

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

// Static routes that don't need database access
app.get("/", (req, res) => {
  console.log('Handling root route');
  res.render("index", {
    layout: "main",
    title: "Airbrush Dashboard"
  });
});

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

app.get("/free-tool", (req, res) => {
  res.render("free-tool", {
    layout: "main",
    title: "Free Tool - Airbrush Dashboard"
  });
});

app.get("/free-tool-2", (req, res) => {
  res.render("free-tool-2", {
    layout: "main",
    title: "Free Tool 2 - Airbrush Dashboard"
  });
});

app.get("/privacy-policy", (req, res) => {
  res.render("privacy-policy", {
    layout: "main",
    title: "Privacy Policy - Airbrush Dashboard"
  });
});

app.get("/terms-of-service", (req, res) => {
  res.render("terms-of-service", {
    layout: "main",
    title: "Terms of Service - Airbrush Dashboard"
  });
});

app.get("/lifetime-deal", (req, res) => {
  res.render("lifetime-deal", {
    layout: "main",
    title: "Lifetime Deal - Airbrush Dashboard"
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

// MongoDB connection and database-dependent routes
MongoClient.connect(connectionString, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
}).then(async (client) => {
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

  // Database-dependent routes
  app.post("/generate-response", async (req, res) => {
    try {
    const conversation = req.body.messages;
    const assistantMessage = await aiChat(conversation);
    res.json({ message: marked(assistantMessage) });
    } catch (error) {
      console.error('Error generating response:', error);
      res.status(500).json({ error: 'Failed to generate response' });
    }
  });

  app.get("/blog", async (req, res) => {
    try {
      const articles = await blogCollection.find({}).toArray();
      articles.forEach((article) => {
        article.date = article.date.toISOString().split("T")[0];
      });
      res.render("blog", { 
        layout: "main",
        title: "Blog - Airbrush Dashboard",
        articles: [...articles].reverse() 
      });
    } catch (error) {
      console.error("Error fetching blog articles:", error);
      res.status(500).render("error", {
        layout: "main",
        title: "Error",
        error: "Failed to fetch blog articles"
      });
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
        layout: "main",
        title: generatorPage.title || "Generator Page",
        generatorPage: generatorPage,
      });
    } catch (error) {
      console.error("Error fetching generator page:", error);
      res.status(500).render("error", {
        layout: "main",
        title: "Error",
        error: "Failed to fetch generator page"
      });
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
      console.error("Error generating sitemap:", error);
      res.status(500).send("Error generating sitemap");
    }
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

  // Modify your route update function
  // async function updateRoutes() {
  //   try {
  //     await initializeDynamicRoutes(app);
  //     await restartServer();
  //     return { success: true, message: 'Routes updated and server restarted' };
  //   } catch (error) {
  //     console.error('Error updating routes:', error);
  //     return { success: false, message: error.message };
  //   }
  // }

  // // Function to restart the server using PM2
  // async function restartServer() {
  //   console.log('Restarting server');
  //   return new Promise((resolve, reject) => {
  //     pm2.connect((err) => {
  //       if (err) {
  //         console.error(err);
  //         reject(err);
  //         return;
  //       }

  //       pm2.restart('server', (err) => {
  //         if (err) {
  //           console.error(err);
  //           reject(err);
  //         } else {
  //           console.log('Server restarted successfully');
  //           resolve();
  //         }
  //         pm2.disconnect();
  //       });
  //     });
  //   });
  // }

  // // Global error handler - should be last
  // app.use((err, req, res, next) => {
  //   console.error('Server error:', err);
  //   res.status(500).render('error', {
  //     layout: "main",
  //     title: "Error",
  //     error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  //   });
  // });

  // 404 handler - should be after all routes
  app.use((req, res) => {
    console.log('404 Not Found:', req.url);
    res.status(404).render('404', {
      layout: "main",
      title: "404 - Page Not Found",
      url: req.url
    });
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
}).catch((err) => {
  console.error("MongoDB Connection Error:", err);
});

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

  // Global error handler - should be last
  app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).render('error', {
      layout: "main",
      title: "Error",
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
    });
  });
