
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Story, Character } from '../types';

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please check your environment variables.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Helper: Wait for a specified duration
 */
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper: Retry operation with exponential backoff
 */
async function retryWithBackoff<T>(operation: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Check for 429 (Resource Exhausted) or 503 (Service Unavailable)
    if (retries > 0 && (error?.status === 429 || error?.code === 429 || error?.message?.includes('429') || error?.status === 503)) {
      console.warn(`Rate limit or server busy. Retrying in ${delay}ms... (${retries} retries left)`);
      await wait(delay);
      return retryWithBackoff(operation, retries - 1, delay * 2); // Double the delay for next retry
    }
    throw error;
  }
}

/**
 * Helper to decode base64 to Uint8Array
 */
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Helper to convert Raw PCM data to AudioBuffer
 */
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Analyzes the user's prompt to identify potential characters.
 */
export const analyzeStoryCharacters = async (prompt: string): Promise<{role: string, name: string}[]> => {
  const ai = getAiClient();
  const modelId = "gemini-2.5-flash";

  const analysisPrompt = `
    Analyze the following story idea: "${prompt}".
    Identify the main characters needed for this story.
    If the story implies specific characters (e.g. "a dog and a cat"), list them.
    If the story is vague, suggest 1 or 2 suitable archetypes.
    
    Return a JSON list. For each character, provide:
    - role: A short description (e.g., "The brave knight", "The little robot").
    - name: A suggested name suitable for a children's story.
  `;

  return retryWithBackoff(async () => {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: analysisPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING },
              name: { type: Type.STRING }
            },
            required: ["role", "name"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse character analysis", e);
      return [];
    }
  });
};

/**
 * Generates the text structure of the story (Title + Pages with visual descriptions).
 */
export const generateStoryStructure = async (topic: string, characters: Character[] = [], pageCount: number = 5): Promise<Story> => {
  const ai = getAiClient();
  
  // Using Flash for fast text generation
  const modelId = "gemini-2.5-flash"; 

  const characterNames = characters.map(c => `${c.name} (${c.role || 'character'})`).join(', ');
  const characterContext = characters.length > 0 
    ? `The story must feature the following characters: ${characterNames}.` 
    : '';

  const prompt = `
    Create a short, magical children's storybook based on the following topic: "${topic}".
    ${characterContext}
    The story should be exactly ${pageCount} pages long.
    Detect the language of the topic (e.g., Italian, English, Spanish) and write the story text in that same language.
    
    Structure the response as a JSON object with:
    1. 'title': The title of the story.
    2. 'subtitle': A creative, charming subtitle for the story.
    3. 'visualStyle': A specific, consistent art style description for this book (e.g. "Soft pastel watercolor", "Vibrant 3D animated movie render", "Paper cutout art"). Choose one that fits the mood.
    4. 'coverImagePrompt': A detailed, artistic description for the book's cover illustration that captures the essence of the story.
    5. 'pages': An array of pages. For each page, provide:
       - 'text': The story text (max 40 words).
       - 'imagePrompt': A detailed visual description for the illustrator.
    
    CRITICAL INSTRUCTION FOR CONSISTENCY:
    In EVERY 'imagePrompt' (and the coverPrompt), you MUST explicitly describe the physical appearance of the characters present in that scene.
    Do NOT just write "Tom enters the room".
    You MUST write "Tom, a small boy with messy brown hair wearing a red t-shirt and blue jeans, enters the room."
    Repeating these physical details in every single prompt is ESSENTIAL.
  `;

  return retryWithBackoff(async () => {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subtitle: { type: Type.STRING },
            visualStyle: { type: Type.STRING },
            coverImagePrompt: { type: Type.STRING },
            pages: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  imagePrompt: { type: Type.STRING }
                },
                required: ["text", "imagePrompt"]
              }
            }
          },
          required: ["title", "subtitle", "visualStyle", "coverImagePrompt", "pages"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    return JSON.parse(text) as Story;
  });
};

/**
 * Creates a new image prompt based on edited story text
 */
export const generateImagePromptFromText = async (storyText: string, style: string, characters: Character[]): Promise<string> => {
  const ai = getAiClient();
  const modelId = "gemini-2.5-flash";

  const characterContext = characters.length > 0 
    ? `CHARACTERS TO INCLUDE IF MENTIONED (Maintain strict consistency): ${characters.map(c => `${c.name} (${c.role}): [Insert standard physical description if known, otherwise keep consistent]`).join('; ')}`
    : '';

  const prompt = `
    I have updated the text for a page in a children's storybook. 
    Please write a new "imagePrompt" for the illustrator based on this new text.
    
    NEW STORY TEXT: "${storyText}"
    VISUAL STYLE: ${style}
    ${characterContext}

    INSTRUCTIONS:
    - Describe the scene visually based on the text.
    - If characters from the list are mentioned, YOU MUST include a detailed physical description of them (clothes, hair, etc) to ensure consistency with previous pages.
    - Keep the description concise but detailed enough for an image generator.
    - Do not output JSON. Just output the prompt string.
  `;

  return retryWithBackoff(async () => {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
    });
    return response.text?.trim() || "A beautiful illustration matching the story.";
  });
};

/**
 * Generates an illustration for a specific page.
 */
export const generatePageIllustration = async (imagePrompt: string, characters: Character[] = [], style: string = "Whimsical storybook illustration"): Promise<string> => {
  const ai = getAiClient();
  
  // Using Gemini 2.5 Flash Image (Nano Banana) for efficient generation
  const modelId = "gemini-2.5-flash-image";

  // Identify which characters are mentioned in this page's prompt
  const relevantCharacters = characters.filter(c => 
    imagePrompt.toLowerCase().includes(c.name.toLowerCase())
  );

  const parts: any[] = [];

  // 1. Add Reference Images (if any characters match and have images)
  const hasImages = relevantCharacters.some(c => !!c.imageData);

  relevantCharacters.forEach(c => {
    if (c.imageData) {
      // Extract base64 data and mime type
      const matches = c.imageData.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
          parts.push({
              inlineData: {
                  mimeType: matches[1],
                  data: matches[2]
              }
          });
      }
    }
  });

  // 2. Add Text Prompt with STRICT IDENTITY PRESERVATION instructions
  // We restructure the prompt to force the model to analyze the reference first
  let enhancedPrompt = `
    TASK: Generate a high-quality storybook illustration.
    
    1. REFERENCE ANALYSIS (CRITICAL):
    - You have been provided with one or more reference images for the character(s).
    - Your HIGHEST PRIORITY is to preserve the exact identity of these characters.
    - Analyze the reference image(s) carefully: specific facial features, hair style, body proportions, and clothing details.
    - You MUST replicate these features EXACTLY in the new image. Do not create a generic version of the character.
  `;
  
  if (relevantCharacters.length > 0) {
      enhancedPrompt += ` 
      CHARACTERS PRESENT: ${relevantCharacters.map(c => c.name).join(', ')}.
      `;
      
      if (hasImages) {
        enhancedPrompt += ` 
        INSTRUCTION: The character(s) in the output MUST be instantly recognizable as the subject in the provided reference image(s). 
        Do not change their face or hair. 
        Take your time to ensure the resemblance is perfect.
        `;
      }
  }

  enhancedPrompt += `
    2. STYLE & SCENE:
    - SCENE DESCRIPTION: ${imagePrompt}
    - VISUAL STYLE: ${style}
    - Apply the visual style to the lighting, texture, and mood, but DO NOT warp or alter the character's fundamental facial geometry.
  
    3. QUALITY GUIDELINES:
    - NO text balloons, NO writing, NO blurry faces, NO distorted limbs. 
    - High resolution, 4k.
  `;

  parts.push({ text: enhancedPrompt });

  return retryWithBackoff(async () => {
    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: { parts },
        config: {
          // Flash Image configuration
        }
      });

      // Extract image from response
      for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData && part.inlineData.data) {
              return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          }
      }
      
      throw new Error("No image data found in response");
    } catch (error) {
      console.error("Image generation failed:", error);
      // Re-throw if it's a rate limit so retryWithBackoff catches it. Otherwise return placeholder.
      if ((error as any)?.status === 429 || (error as any)?.code === 429 || (error as any)?.message?.includes('429')) {
          throw error;
      }
      return `https://picsum.photos/800/800?blur=2`; 
    }
  });
};

/**
 * Generates speech for the story text.
 */
export const generatePageAudio = async (text: string, audioContext: AudioContext): Promise<AudioBuffer> => {
  const ai = getAiClient();
  const modelId = "gemini-2.5-flash-preview-tts";

  return retryWithBackoff(async () => {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("No audio generated");
    }

    // Decode the base64 string and then the PCM audio data
    const rawBytes = decode(base64Audio);
    return await decodeAudioData(rawBytes, audioContext, 24000, 1);
  });
};
