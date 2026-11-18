const https = require('https');
const { supabase } = require('../config/supabase');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

/**
 * Handle chat conversation with Gemini AI for camping assistance
 * POST /api/ai/chat
 * Body: { message, history }
 */
async function chat(req, res) {
  try {
    const { message, history = [] } = req.body;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'GEMINI_API_KEY belum dikonfigurasi di environment server.',
      });
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Pesan (message) wajib diisi.',
      });
    }

    // 1. Fetch available products from database to enrich AI context
    let productsSummary = '';
    try {
      const client = req.supabase || supabase;
      const { data: products } = await client
        .from('products')
        .select('name, category, price, stock, sub')
        .gt('stock', 0)
        .limit(20);

      if (products && products.length > 0) {
        productsSummary = 'Daftar alat camping yang saat ini tersedia untuk disewa di Campy:\n' +
          products.map(p => `- ${p.name} (${p.category}${p.sub ? ' - ' + p.sub : ''}): Rp ${p.price.toLocaleString('id-ID')}/hari (stok: ${p.stock})`).join('\n');
      }
    } catch (dbErr) {
      console.warn('Could not fetch products for AI context:', dbErr.message);
    }

    // 2. Build system instruction and conversation contents
    const systemPrompt = `Kamu adalah Campy AI Assistant, asisten virtual resmi untuk aplikasi rental dan perlengkapan camping/hiking "Campy".
Tugas utamamu:
1. Merekomendasikan perlengkapan camping dan mendaki yang tepat sesuai kebutuhan pengguna (jumlah orang, cuaca, gunung, durasi).
2. Memberikan tips praktis mendaki gunung, memasak di alam bebas, tips bertahan saat hujan/dingin, dan keselamatan outdoor.
3. Mengaitkan rekomendasi dengan barang yang tersedia di Campy dengan ramah.
4. Gunakan bahasa Indonesia yang santun, ramah, antusias, dan mudah dipahami. Gunakan format poin atau emoji jika cocok.

${productsSummary ? productsSummary : 'Campy menyediakan sewa Tenda (Shelter), Alat Masak (Kitchen), Lampu (Lighting), dan Apparel/Carrier.'}`;

    const contents = [];

    // System context as first turn
    contents.push({
      role: 'user',
      parts: [{ text: `[System Instructions]: ${systemPrompt}\n\nMohon patuhi peranmu sebagai Campy AI.` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Halo! Saya Campy AI Assistant, siap membantu segala kebutuhan camping dan petualangan outdoor Anda! Ada yang bisa saya bantu atau rekomendasikan hari ini?' }],
    });

    // Append conversation history
    if (Array.isArray(history)) {
      for (const h of history) {
        if (h.role && h.text) {
          contents.push({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(h.text) }],
          });
        }
      }
    }

    // Append latest user message
    contents.push({
      role: 'user',
      parts: [{ text: message.trim() }],
    });

    const payload = JSON.stringify({ contents });

    // 3. Send request to Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const responseText = await new Promise((resolve, reject) => {
      const request = https.request(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15000,
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              const reply = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (reply) {
                resolve(reply);
              } else {
                reject(new Error('Respon Gemini tidak memiliki konten teks.'));
              }
            } catch (jsonErr) {
              reject(new Error(`Gagal mem-parsing respon Gemini: ${jsonErr.message}`));
            }
          } else {
            try {
              const errObj = JSON.parse(data);
              reject(new Error(errObj?.error?.message || `HTTP ${response.statusCode}`));
            } catch (_) {
              reject(new Error(`Gemini API error (Status ${response.statusCode})`));
            }
          }
        });
      });

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Waktu tunggu koneksi ke Gemini API habis (timeout).'));
      });

      request.write(payload);
      request.end();
    });

    return res.status(200).json({
      success: true,
      data: {
        reply: responseText,
        model: GEMINI_MODEL,
      },
    });
  } catch (err) {
    console.error('Campy AI chat error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal mendapatkan respon dari Campy AI.',
      error: err.message,
    });
  }
}

module.exports = {
  chat,
};
