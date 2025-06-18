// --- START OF FILE index.js (with /generate-from-image API) ---

// index.js

// 1. Load Environment Variables First
// This must be at the very top of your file before any other code
// that might access process.env variables.
require('dotenv').config();

// 2. Import Necessary Modules
const express = require('express');
const cors = require('cors'); // Essential for allowing front-end applications to make requests
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios'); // Import axios for making HTTP requests to the image generation API
const FormData = require('form-data'); // Import FormData for sending files
const fs = require('fs'); // For reading files (images)
const { monitorEventLoopDelay } = require('perf_hooks');
const { error } = require('console');
const multer = require('multer');
const path = require('path');

// 3. Retrieve and Parse Environment Variables
// Ensure these variables match what you have in your .env file
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL_NAME = process.env.GEMINI_MODEL_NAME || 'gemini-1.5-flash-latest';

// Parse generation configuration parameters from strings to numbers
const GEMINI_TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE || '0.7');
const GEMINI_TOP_P = parseFloat(process.env.GEMINI_TOP_P || '0.95');
const GEMINI_TOP_K = parseInt(process.env.GEMINI_TOP_K || '64', 10); // Base 10 for parseInt
const GEMINI_MAX_OUTPUT_TOKENS = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '8192', 10);
const PROJECT_NAME = process.env.PROJECT_NAME || 'MyExpressGeminiApp';


// 4. Validate Essential Environment Variables
if (!GOOGLE_API_KEY) {
    console.error("❌ Error: GOOGLE_API_KEY is not set in your .env file.");
    console.error("Please ensure your .env file is correctly configured and contains GOOGLE_API_KEY.");
    console.error("Get your API key from: https://aistudio.google.com/app/apikey");
    process.exit(1); // Exit the application if the critical API key is missing
}


// 5. Initialize Google Generative AI Client
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL_NAME,
    generationConfig: {
        temperature: GEMINI_TEMPERATURE,
        topP: GEMINI_TOP_P,
        topK: GEMINI_TOP_K,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    },
    // Optional: Add safety settings if you need to customize content moderation
    // safetySettings: [
    //   {
    //     category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    //     threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    //   },
    // ],
});

// 6. Initialize Express Application
const app = express();

// 7. Apply Middleware
app.use(express.json()); // Middleware to parse JSON request bodies
app.use(cors());         // Enable CORS for all routes (important for front-end dev)
                         // In production, consider restricting CORS to specific origins:
                         // app.use(cors({ origin: 'https://your-frontend-domain.com' }));

// Middleware to parse multipart/form-data (for file uploads)
app.use(express.urlencoded({ extended: true })); // Required for parsing form data


// 8. Define API Routes

// Health Check / Root Route
app.get('/', (req, res) => {
    res.status(200).json({
        message: `Welcome to ${PROJECT_NAME} API!`,
        status: 'Server is running',
        environment: NODE_ENV,
        geminiModel: GEMINI_MODEL_NAME,
        apiVersion: 'v1'
    });
});
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Destination folder
    },
    filename: function (req, file, cb) {
        // Create a unique filename to prevent overwrites
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname); // Get the original file extension
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ storage: storage }); // Create the multer instance

// Route to generate text content using Gemini Flash-API
app.post('/generate-text', async (req, res) => {
    const { prompt } = req.body; // Expecting a 'prompt' field in the JSON request body

    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        return res.status(400).json({ error: 'A valid text prompt is required in the request body.' });
    }

    try {
        console.log(`[${new Date().toISOString()}] Received request for prompt (first 50 chars): "${prompt.substring(0, 50)}..."`);

        // Make the API call to Gemini
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text(); // Get the generated text content

        console.log(`[${new Date().toISOString()}] Successfully generated content.`);
        res.status(200).json({ generatedText: text });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error generating content:`, error);

        // More granular error handling for specific API errors can be added here
        if (error.status && error.status === 429) {
            return res.status(429).json({ error: 'Rate limit exceeded. Please try again shortly.', details: error.message });
        }
        if (error.response && error.response.error) {
            return res.status(500).json({ error: 'Gemini API Error', details: error.response.error.message });
        }

        res.status(500).json({ error: 'Failed to generate content due to an internal server error.', details: error.message });
    }
});


// Route to generate text based on an uploaded image (e.g., using Gemini for image editing or analysis)
app.post('/generate-from-image', upload.single('image'), async (req, res) => {
    const prompt = req.body.prompt || 'Describe the image'; // Get the prompt from the request body
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
    }

    try {
        const imagePath = req.file.path;
        const imageMimeType = req.file.mimetype;

        // Read the image file as a buffer
        const imageBuffer = fs.readFileSync(imagePath);


        // Create the prompt with inlineData
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType: imageMimeType,
                    data: imageBuffer.toString('base64'),
                },
            },
        ]);

        const response = await result.response;
        res.json({ output: response.text() });

    } catch (error) {
        console.error('Error during image generation:', error);  // Log the error
        res.status(500).json({ error: error.message });  // Send the error message
    } finally {
        // Always delete the temporary file, even if errors occur
        if (req.file && req.file.path) { // Make sure the file exists before deleting
            fs.unlink(req.file.path, (err) => {
                if (err) {
                    console.error('Error deleting temporary file:', err); // Log deletion errors
                }
            });
        }
    }
});

// Route to generate text based on an uploaded document (e.g., using Gemini for document analysis)
app.post('/generate-from-document', upload.single('document'), async (req, res) => {
    try {
        const filePath = req.file.path;
        const buffer = fs.readFileSync(filePath); // Read file into a buffer
        const base64Data = buffer.toString('base64');
        const mimeType = req.file.mimetype;

        const documentPart = {
            inlineData: { data: base64Data, mimeType },
        };

        const result = await model.generateContent(['Analyze this document:', documentPart]);
        const response = await result.response;
        res.json({ output: response.text() });

    } catch (error) {
        console.error('Error generating content from document:', error);  // Log the error
        res.status(500).json({ error: error.message });
    } finally {
        // Delete the temporary file, even if an error occurred
        if (req.file && req.file.path) {
            fs.unlinkSync(req.file.path); // Synchronous deletion is okay here.
            // Consider asynchronous deletion for performance in a very busy app
            // fs.unlink(req.file.path, (err) => {
            //     if (err) {
            //         console.error('Error deleting temporary file:', err);
            //     }
            // });
        }
    }
});

// Route to generate text based on an uploaded audio (e.g., using Gemini for audio analysis)
app.post('/generate-from-audio', upload.single('audio'), async (req, res) => {
    try {
        const audioBuffer = fs.readFileSync(req.file.path); // Read audio file into buffer
        const base64Audio = audioBuffer.toString('base64'); // Convert to base64
        const mimeType = req.file.mimetype;

        const audioPart = {
            inlineData: { data: base64Audio, mimeType },
        };

        const result = await model.generateContent(['Transcribe or analyze the following audio:', audioPart]);
        const response = await result.response;
        res.json({ output: response.text() });

    } catch (err) {
        console.error('Error generating content from audio:', err); // Log the error
        res.status(500).json({ error: err.message });
    } finally {
        if (req.file && req.file.path) {
            fs.unlinkSync(req.file.path); // Delete the temporary audio file
            // fs.unlink(req.file.path, (err) => { // Alternative Asynchronous Deletion
            //     if (err) {
            //         console.error('Error deleting temporary audio file:', err);
            //     }
            // });
        }
    }
});

// 9. Start the Express Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`Running in ${NODE_ENV} mode`);
    console.log(`Using Gemini Model: ${GEMINI_MODEL_NAME}`);
    console.log(`Project: ${PROJECT_NAME}`);
    // For security, avoid logging the full API key.
    // You can log the last few characters for debugging if necessary:
    // console.log(`API Key (last 4 chars): ${GOOGLE_API_KEY.slice(-4)}`);
});
