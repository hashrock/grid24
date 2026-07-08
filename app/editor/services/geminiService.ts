import { GoogleGenAI, Type } from "@google/genai";

const getClient = () => {
  const apiKey = (import.meta as any).env?.VITE_API_KEY || (typeof process !== 'undefined' && process.env?.API_KEY);
  if (!apiKey) {
    console.error("API_KEY is missing");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const generateIconPath = async (prompt: string): Promise<string | null> => {
  const ai = getClient();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Generate a simplified SVG path data string (d attribute) for a 32x32 grid icon representing: "${prompt}".
      Use only absolute coordinates (M, L, C). Avoid arcs (A) or quadratic (Q) if possible, approximate with Cubic (C) for compatibility.
      Keep it simple, suitable for a stroke icon.
      Return ONLY the path string.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pathData: {
              type: Type.STRING,
              description: "The standard SVG path data string (e.g. M 10 10 C ...)"
            }
          }
        }
      }
    });

    const json = JSON.parse(response.text || "{}");
    return json.pathData || null;

  } catch (error) {
    console.error("Gemini generation error:", error);
    return null;
  }
};
