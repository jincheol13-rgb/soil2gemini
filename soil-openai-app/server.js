import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'mock-key'
});

app.post('/api/analyze-soil', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_API_KEY' || apiKey === 'mock-key') {
      console.log('[System] OpenAI API key is missing. Returning mock data instead.');
      return res.json(getMockData());
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are an expert soil analysis OCR program.
Your task is to analyze the provided soil fertilizer prescription sheet image and extract the chemical properties of the soil.
Please return a clean JSON object containing the following keys:
- pH (Soil acidity)
- organic_matter (Organic matter, OM, g/kg or %)
- available_phosphate (Av. P2O5, mg/kg)
- potassium (K, cmol+/kg)
- calcium (Ca, cmol+/kg)
- magnesium (Mg, cmol+/kg)
- electrical_conductivity (EC, dS/m)

Each key MUST contain a sub-object with two fields:
- "range": The optimal or standard range shown on the report (e.g. "6.0 - 6.5", "25 - 35", etc.)
- "result": The actual measured result value for this soil sample (e.g. "6.8", "18", etc.)

If a property is not measured or not present on the sheet, use "N/A" for its values.

Ensure the output is strictly structured as follows:
{
  "pH": { "range": "...", "result": "..." },
  "organic_matter": { "range": "...", "result": "..." },
  "available_phosphate": { "range": "...", "result": "..." },
  "potassium": { "range": "...", "result": "..." },
  "calcium": { "range": "...", "result": "..." },
  "magnesium": { "range": "...", "result": "..." },
  "electrical_conductivity": { "range": "...", "result": "..." }
}`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ]
    });

    const parsedJson = JSON.parse(response.choices[0].message.content);
    res.json(parsedJson);

  } catch (error) {
    console.error('Soil Analysis Error:', error);
    res.status(500).json({ error: 'Failed to analyze soil image.', details: error.message });
  }
});

function getMockData() {
  return {
    "pH": { "range": "6.0 ~ 6.5", "result": "6.7" },
    "organic_matter": { "range": "25 ~ 35 g/kg", "result": "22" },
    "available_phosphate": { "range": "300 ~ 400 mg/kg", "result": "520" },
    "potassium": { "range": "0.70 ~ 0.80 cmol+/kg", "result": "0.85" },
    "calcium": { "range": "5.0 ~ 6.0 cmol+/kg", "result": "6.3" },
    "magnesium": { "range": "1.5 ~ 2.0 cmol+/kg", "result": "1.8" },
    "electrical_conductivity": { "range": "2.0 dS/m 이하", "result": "0.9" }
  };
}

app.listen(PORT, () => {
  console.log(`Server is running locally on http://localhost:${PORT}`);
});
