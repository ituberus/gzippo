// backend/server.js

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import path from 'path';
import { WebSocketServer } from 'ws';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Verify that API keys are loaded
if (!process.env.HUME_API_KEY || !process.env.HUME_SECRET_KEY) {
  console.error('Error: HUME_API_KEY and HUME_SECRET_KEY must be set in .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'database.json');

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://d4b7-102-89-82-36.ngrok-free.app',
'https://gboxboss.github.io',
  
  'https://your-frontend-domain.com' // Replace with your actual frontend domain
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (!allowedOrigins.includes(origin)) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true, // If you need to send cookies or authentication headers
}));

app.use(express.json());

// Initialize JSON Database
async function initializeDatabase() {
  try {
    await fs.access(DB_PATH);
    console.log('Database file exists.');
  } catch {
    // Create new database file if it doesn't exist
    await fs.writeFile(DB_PATH, JSON.stringify({ agents: [] }, null, 2));
    console.log('Created new database file.');
  }
}

// Helper Functions for Database Operations
async function readDatabase() {
  const data = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(data);
}

async function writeDatabase(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// Helper Function to Interact with Hume API
async function createHumeSystemPrompt(name, promptText) {
  const url = 'https://api.hume.ai/v0/evi/prompts';
  const apiKey = process.env.HUME_API_KEY;
  const secretKey = process.env.HUME_SECRET_KEY;

  const bodyPayload = {
    name,
    text: promptText,
    version_description: 'User-defined system prompt.',
    version_type: 'FIXED',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hume-Api-Key': apiKey,
      'X-Hume-Secret-Key': secretKey,
    },
    body: JSON.stringify(bodyPayload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to create system prompt: ${response.status} - ${response.statusText} - ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function createHumeConfig(name, promptId, voiceName) {
  const url = 'https://api.hume.ai/v0/evi/configs';
  const apiKey = process.env.HUME_API_KEY;
  const secretKey = process.env.HUME_SECRET_KEY;

  const bodyPayload = {
    evi_version: '2',
    name,
    version_description: 'User-chosen system prompt & voice',
    prompt: {
      id: promptId,
    },
    voice: {
      provider: 'HUME_AI',
      name: voiceName,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hume-Api-Key': apiKey,
      'X-Hume-Secret-Key': secretKey,
    },
    body: JSON.stringify(bodyPayload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to create config: ${response.status} - ${response.statusText} - ${JSON.stringify(data)}`
    );
  }

  return data;
}

// API Route to Create a New AI Agent
app.post('/api/agents', async (req, res) => {
  const { name, icon = '', description, system_prompt, voice_name } = req.body;

  if (!name || !system_prompt || !voice_name) {
    return res.status(400).json({ message: 'Name, System Prompt, and Voice Name are required.' });
  }

  try {
    const db = await readDatabase();

    // Check if name already exists
    if (db.agents.some(agent => agent.name === name)) {
      return res.status(409).json({
        message: `Prevented duplicate key for prompt (NAME: ${name})`,
      });
    }

    // Prepend the default prompt
    const defaultPrompt =
      'Your name is Voxa, a crypto AI. I can do other stuff outside cryptocurrency too. ';
    const finalPrompt = defaultPrompt + system_prompt;

    // Create System Prompt via Hume API
    const systemPromptData = await createHumeSystemPrompt(name, finalPrompt);
    const promptId = systemPromptData.id;

    // Validate the voice_name against allowed voices
    const allowedVoices = ["KORA", "DACHER", "ITO", "ARIA", "FINN", "NOVA", "QUINN", "ZANE"];
    if (!allowedVoices.includes(voice_name.toUpperCase())) {
      return res.status(400).json({
        message: `Invalid voice name '${voice_name}'. Allowed voices are: ${allowedVoices.join(', ')}`,
      });
    }

    // Create Config via Hume API with the selected voice
    const configName = `UserCreatedEVIConfig_${Date.now()}`;
    const configData = await createHumeConfig(configName, promptId, voice_name.toUpperCase());
    const configId = configData.id;

    // Create new agent
    const newAgent = {
      id: db.agents.length + 1,
      name,
      icon,
      description,
      system_prompt: finalPrompt,
      config_id: configId,
      created_at: new Date().toISOString()
    };

    // **Insert new agent at the beginning to maintain order**
    db.agents.unshift(newAgent);
    await writeDatabase(db);

    return res.status(201).json({
      message: 'AI Agent created successfully.',
      agent: {
        ...newAgent,
        permalink: `/${name}`, // Adjusted to match frontend navigation
      },
    });

  } catch (error) {
    console.error('Error creating AI agent:', error.message);
    return res.status(500).json({ message: error.message });
  }
});

// API Route to Get All AI Agents with Pagination (Sorted Newest to Oldest)
app.get('/api/agents', async (req, res) => {
  try {
    const db = await readDatabase();
    let { limit, offset } = req.query;
    limit = parseInt(limit) || db.agents.length;
    offset = parseInt(offset) || 0;

    // **Since agents are inserted at the beginning, no need to sort**
    const paginatedAgents = db.agents.slice(offset, offset + limit);

    // **Logging for debugging**
    console.log(`Fetching agents: limit=${limit}, offset=${offset}`);
    paginatedAgents.forEach(agent => {
      console.log(`Agent: ${agent.name}, Created At: ${agent.created_at}`);
    });

    return res.status(200).json({ agents: paginatedAgents });
  } catch (error) {
    console.error('Database error:', error.message);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// API Route to Get AI Agent by Name
app.get('/api/agents/:name', async (req, res) => {
  const name = req.params.name;
  try {
    const db = await readDatabase();
    const agent = db.agents.find(a => a.name === name);
    
    if (agent) {
      return res.status(200).json({ agent });
    } else {
      return res.status(404).json({ message: `No AI agent found with name '${name}'.` });
    }
  } catch (error) {
    console.error('Database error:', error.message);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// API Route to Authenticate with Hume and Get Access Token
app.post('/api/hume/authenticate', async (req, res) => {
  const { config_id } = req.body;

  if (!config_id) {
    return res.status(400).json({ message: 'config_id is required.' });
  }

  try {
    // Validate the config_id
    const db = await readDatabase();
    const agent = db.agents.find(a => a.config_id === config_id);
    if (!agent) {
      return res.status(404).json({ message: 'Agent not found.' });
    }

    // Authenticate with Hume using server-side credentials
    const authString = `${process.env.HUME_API_KEY}:${process.env.HUME_SECRET_KEY}`;
    const encoded = Buffer.from(authString).toString('base64');

    const response = await fetch('https://api.hume.ai/oauth2-cc/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${encoded}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }).toString(),
      cache: 'no-cache',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText} - ${JSON.stringify(data)}`);
    }

    // Return the access token to the frontend
    res.status(200).json({ access_token: data.access_token });
  } catch (error) {
    console.error('Error authenticating with Hume:', error);
    res.status(500).json({ message: 'Failed to authenticate with Hume.' });
  }
});

// Serve call.html for permalinks (e.g., /john)
app.get('/:name', async (req, res) => {
  const name = req.params.name;
  
  try {
    const db = await readDatabase();
    const agent = db.agents.find(a => a.name === name);
    
    if (agent) {
      // Serve call.html if agent exists
      return res.sendFile(path.join(__dirname, '../frontend/call.html'));
    } else {
      // Serve 404 page or a simple error message if agent not found
      return res.status(404).send(`<h1>404 Not Found</h1><p>No AI agent found with name '${name}'.</p>`);
    }
  } catch (error) {
    console.error('Database error:', error.message);
    return res.status(500).send('Internal server error.');
  }
});

// Serve Frontend
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Initialize WebSocket Server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request) => {
  console.log('WebSocket connection established.');

  ws.on('message', async (message) => {
    try {
      const parsedMessage = JSON.parse(message);

      if (parsedMessage.type === 'audio_input') {
        const audioData = parsedMessage.data;

        // Here, you would process the audio_data with Hume's API or your AI model
        // For demonstration, we'll simulate a response

        // Simulate processing delay
        setTimeout(() => {
          // Simulate AI response
          const aiResponse = {
            type: 'assistant_message',
            message: {
              role: 'assistant',
              content: 'Hello! How can I assist you today?',
            },
          };
          ws.send(JSON.stringify(aiResponse));

          // Simulate audio output (base64 encoded)
          const simulatedAudioOutput = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAABAAgAZGF0YQAAAAA='; // Example: A silent audio blob
          const audioOutputMessage = {
            type: 'audio_output',
            data: simulatedAudioOutput,
          };
          ws.send(JSON.stringify(audioOutputMessage));
        }, 1000);
      }
    } catch (err) {
      console.error(`Error processing WebSocket message: ${err.message}`);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed.');
  });
});

// Initialize database and start server
(async () => {
  try {
    await initializeDatabase();
    const server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
})();
