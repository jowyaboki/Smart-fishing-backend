import { config } from '../config';

export interface AiAdvisorRequest {
  query: string;
  context?: {
    location?: { latitude: number; longitude: number; name?: string };
    targetSpecies?: string;
    tide?: string;
    weather?: string;
  };
}

export interface AiAdvisorResponse {
  answer: string;
  tips: string[];
  recommendedGear?: {
    rod?: string;
    line?: string;
    hookSize?: string;
    bait?: string;
  };
  safetyNotice?: string;
  source: 'gemini' | 'rule_engine';
}

export class AiAssistantService {
  public static async askAdvisor(req: AiAdvisorRequest): Promise<AiAdvisorResponse> {
    const userPrompt = req.query.toLowerCase();

    // If Gemini API key is configured, query Gemini Generative Language API
    if (config.geminiApiKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `You are the Smart Fishing Morocco AI Advisor, an expert in Atlantic & Mediterranean surfcasting, rock fishing, and offshore angling in Morocco.
Context: ${JSON.stringify(req.context || {})}
User question: ${req.query}
Provide a clear answer, fishing tips, recommended gear, and safety precautions.`,
                    },
                  ],
                },
              ],
            }),
            signal: AbortSignal.timeout(5000),
          }
        );

        if (geminiRes.ok) {
          const data = (await geminiRes.json()) as any;
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            return {
              answer: text,
              tips: [
                'Time your cast 2 hours before high tide for peak strike rates.',
                'Use fresh local Moroccan sardine or ragworm for best results.',
              ],
              source: 'gemini',
            };
          }
        }
      } catch {
        // Fall back gracefully to rule-based expert engine
      }
    }

    // Expert rule-based response for Moroccan waters
    return this.generateExpertAdvice(userPrompt, req.context);
  }

  private static generateExpertAdvice(query: string, context?: AiAdvisorRequest['context']): AiAdvisorResponse {
    if (query.includes('bass') || query.includes('loubina') || query.includes('loup')) {
      return {
        answer:
          'European Seabass (Loubina) in Moroccan waters thrives in oxygenated white water, surf breaks, and rocky outlets. They feed aggressively on incoming tides near dawn or dusk.',
        tips: [
          'Fish during rising tides with 1.0m - 1.8m wave height for optimal foam cover.',
          'Effective lures: 12-14cm sinking minnows, soft plastic sandeels, and live sardine.',
          'Look for current breaks and rip currents where baitfish wash out.',
        ],
        recommendedGear: {
          rod: '2.7m - 3.0m Spinning rod (15-50g action)',
          line: 'PE 1.2 - 1.5 Braid with 0.35mm fluorocarbon leader',
          hookSize: '1/0 to 3/0 Wide gape hook',
          bait: 'Live sardine, Korean ragworm, or jerkbait lures',
        },
        safetyNotice: 'Watch out for rogue waves when fishing from Atlantic rock ledges.',
        source: 'rule_engine',
      };
    }

    if (query.includes('bream') || query.includes('sar') || query.includes('dorade')) {
      return {
        answer:
          'Sar (White Seabream) and Dorade Royale are abundant on Moroccan rock reefs and sandy embayments. They favor surging wave action that dislodges crustaceans and mollusks.',
        tips: [
          'Crushed sea urchin or sardine paste (broumé) acts as an irresistible groundbait.',
          'Fish the rising tide into full high tide close to submerged rocks.',
          'Use sensitive quiver tips to detect light taps.',
        ],
        recommendedGear: {
          rod: '4.2m - 4.5m Surfcasting or Bolognese rock rod',
          line: '0.28mm Monofilament or PE 1.0 Braid with 0.22mm Fluorocarbon leader',
          hookSize: '#2 to #6 Chinu hooks',
          bait: 'Fresh shrimp, crab chunks, mussels, or lugworm',
        },
        safetyNotice: 'Ensure non-slip wading boots on wet, weed-covered rocky shelves.',
        source: 'rule_engine',
      };
    }

    if (query.includes('dakhla') || query.includes('corvina') || query.includes('meagre') || query.includes('courbine')) {
      return {
        answer:
          'Meagre (Courbine) in the Moroccan Sahara/Dakhla is a world-class target. Massive specimens cruise sandy gutters and lagoons hunting mullet and cephalopods.',
        tips: [
          'Night sessions during new or full moon tides offer maximum success.',
          'Target drop-offs and channels with strong tidal current.',
          'Allow the fish to run before setting strong circle hooks.',
        ],
        recommendedGear: {
          rod: 'Heavy surfcasting rod 4.5m (100-250g casting weight)',
          line: '0.45mm - 0.50mm Monofilament with 0.70mm shock leader',
          hookSize: '4/0 - 6/0 Forged hook',
          bait: 'Whole fresh cuttlefish, whole fresh squid, or live mullet',
        },
        safetyNotice: 'Always carry a GPS and high-lumen headlamp for night shore fishing.',
        source: 'rule_engine',
      };
    }

    return {
      answer:
        'Welcome to the Smart Fishing Morocco Advisor. Moroccan coasts offer world-class fishing influenced by the Atlantic swell and Canary Current. We recommend matching your tackle to the targeted spot, observing tide transitions, and honoring minimum legal catch sizes.',
      tips: [
        'Rising tide (2 hours before high) is consistently the most productive tide phase.',
        'Match wave height: 0.8m to 1.6m is prime for coastal shore and surfcasting.',
        'Check water clarity: murky water favors smelly natural baits, crystal water favors lures.',
      ],
      recommendedGear: {
        rod: 'Medium-heavy surfcasting or spinning setup',
        line: 'PE 1.2 braid with fluorocarbon shock leader',
        hookSize: '#1 - 2/0 All-purpose marine hooks',
        bait: 'Moroccan Atlantic sardine, shrimp, or squid',
      },
      safetyNotice: 'Never turn your back on the Atlantic swell. Check safety indices before heading out.',
      source: 'rule_engine',
    };
  }
}
