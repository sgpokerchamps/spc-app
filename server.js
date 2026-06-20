require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const QRCode = require('qrcode');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow TD app to fetch member list
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Card layout constants (coordinates on 1573x1000 template)
const CARD = {
  templatePath: path.join(__dirname, 'card_template_blank.png'),
  nameX: 280, nameY: 640,
  idX: 280,   idY: 800,
  qrX: 960,   qrY: 500,
  qrSize: 310,
  nameFontSize: 64,
  idFontSize: 58,
  maxTextWidth: 620,
};

function calcFontSize(text, baseSize, maxWidth) {
  let size = baseSize;
  while (size > 24 && (text.length * size * 0.6) > maxWidth) {
    size -= 2;
  }
  return size;
}

// Generate a randomized Member ID from the current pool of 100
async function generateMemberId() {
  // Get all currently assigned IDs and withheld IDs
  const [{ data: members }, { data: withheld }] = await Promise.all([
    supabase.from('members').select('member_id').not('member_id', 'is', null),
    supabase.from('withheld_ids').select('member_id'),
  ]);

  const assigned = new Set((members || []).map(m => m.member_id));
  const withheldSet = new Set((withheld || []).map(w => w.member_id));
  const assignedCount = assigned.size;

  // Determine current pool (groups of 100)
  const poolIndex = Math.floor(assignedCount / 100);
  const poolStart = poolIndex * 100 + 1;
  const poolEnd = poolStart + 99;

  // Find all unassigned, non-withheld IDs in the current pool
  const available = [];
  for (let i = poolStart; i <= poolEnd; i++) {
    const id = 'SPC-' + String(i).padStart(5, '0');
    if (!assigned.has(id) && !withheldSet.has(id)) available.push(id);
  }

  if (available.length === 0) {
    // Try next pool if current pool is exhausted/withheld
    for (let pool = poolIndex + 1; pool < poolIndex + 10; pool++) {
      const start = pool * 100 + 1;
      for (let i = start; i <= start + 99; i++) {
        const id = 'SPC-' + String(i).padStart(5, '0');
        if (!assigned.has(id) && !withheldSet.has(id)) return id;
      }
    }
  }

  // Pick a random ID from available slots in this pool
  return available[Math.floor(Math.random() * available.length)];
}

// Generate the card PNG as a Buffer
async function generateCard(playerName, memberId, countryCode) {
  // 1. Generate QR code — encode country if available
  const qrData = countryCode ? `${memberId}/${countryCode.toUpperCase()}` : memberId;
  const qrBuffer = await QRCode.toBuffer(qrData, {
    type: 'png',
    width: CARD.qrSize,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });

  // 2. Build SVG text overlay with auto-scaling
  const nameSize = calcFontSize(playerName, CARD.nameFontSize, CARD.maxTextWidth);
  const idSize = calcFontSize(memberId, CARD.idFontSize, CARD.maxTextWidth);
  const svg = `
    <svg width="1573" height="1000" xmlns="http://www.w3.org/2000/svg">
      <style>
        .name { font-family: Arial, sans-serif; font-weight: bold; fill: white; }
        .id   { font-family: Arial, sans-serif; font-weight: bold; fill: white; }
      </style>
      <text x="${CARD.nameX}" y="${CARD.nameY}" class="name" font-size="${nameSize}">${escapeXml(playerName)}</text>
      <text x="${CARD.idX}"   y="${CARD.idY}"   class="id"   font-size="${idSize}">${escapeXml(memberId)}</text>
    </svg>`;

  // 3. Build composite layers
  const layers = [
    { input: qrBuffer,         top: CARD.qrY, left: CARD.qrX },
    { input: Buffer.from(svg), top: 0,         left: 0        },
  ];

  // 4. Fetch and add flag if country is provided
  if (countryCode) {
    try {
      const https = require('https');
      const flagUrl = `https://flagcdn.com/w80/${countryCode.toLowerCase()}.png`;
      const flagBuffer = await new Promise((resolve, reject) => {
        https.get(flagUrl, res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            https.get(res.headers.location, res2 => {
              const chunks = []; res2.on('data', c => chunks.push(c)); res2.on('end', () => resolve(Buffer.concat(chunks))); res2.on('error', reject);
            }).on('error', reject);
          } else {
            const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
          }
        }).on('error', reject);
      });
      // Resize flag to 60x40 and place it after the ID text
      const flagResized = await sharp(flagBuffer).resize(60, 40, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } }).png().toBuffer();
      layers.push({ input: flagResized, top: 768, left: 640 });
    } catch(e) {
      console.error('Flag fetch failed:', e.message);
      // Continue without flag
    }
  }

  // 5. Composite: template + QR + text + flag
  const card = await sharp(CARD.templatePath)
    .composite(layers)
    .png()
    .toBuffer();

  return card;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Send welcome email with card attached
async function sendWelcomeEmail(name, email, memberId, cardBuffer) {
  await resend.emails.send({
    from: `SPC Community <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: 'Your SPC Community Card',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#111;color:#fff;padding:32px;border-radius:12px;">
        <h2 style="color:#C9A227;margin:0 0 8px;">Welcome to the SPC Community, ${escapeHtml(name)}!</h2>
        <p style="color:#ccc;margin:0 0 24px;">Your SPC Community Card is attached below. Save the image to your phone's Photos app — you'll need to show it at tournament check-in.</p>
        <p style="color:#ccc;margin:0 0 8px;">Your Player ID is: <strong style="color:#C9A227;">${memberId}</strong></p>
        <hr style="border:1px solid #333;margin:24px 0;" />
        <p style="color:#888;font-size:12px;">Singapore Poker Championships &bull; sgpokerchamps.com</p>
      </div>
    `,
    attachments: [
      {
        filename: `SPC-Community-Card-${memberId}.png`,
        content: cardBuffer.toString('base64'),
        content_type: 'image/png',
      },
    ],
  });
}

// Send resend email with card attached
async function sendResendEmail(name, email, memberId, cardBuffer) {
  await resend.emails.send({
    from: `SPC Community <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: 'Your SPC Community Card (Resent)',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#111;color:#fff;padding:32px;border-radius:12px;">
        <h2 style="color:#C9A227;margin:0 0 8px;">Here's your card again, ${escapeHtml(name)}!</h2>
        <p style="color:#ccc;margin:0 0 24px;">Your SPC Community Card is attached below. Save the image to your phone's Photos app — you'll need to show it at tournament check-in.</p>
        <p style="color:#ccc;margin:0 0 8px;">Your Player ID is: <strong style="color:#C9A227;">${memberId}</strong></p>
        <hr style="border:1px solid #333;margin:24px 0;" />
        <p style="color:#888;font-size:12px;">Singapore Poker Championships &bull; sgpokerchamps.com</p>
      </div>
    `,
    attachments: [
      {
        filename: `SPC-Community-Card-${memberId}.png`,
        content: cardBuffer.toString('base64'),
        content_type: 'image/png',
      },
    ],
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Registration page
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>SPC Community Card Registration</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#111;color:#fff;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1a1a1a;border:1px solid #C9A227;border-radius:16px;padding:40px 36px;max-width:420px;width:100%}
    .logo{text-align:center;margin-bottom:28px}
    .logo h1{font-size:22px;color:#C9A227;letter-spacing:.08em}
    .logo p{color:#888;font-size:13px;margin-top:6px}
    .tabs{display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid #333}
    .tab{flex:1;padding:10px;text-align:center;font-size:14px;color:#888;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s}
    .tab.active{color:#C9A227;border-bottom-color:#C9A227}
    .tab:hover{color:#fff}
    .panel{display:none}
    .panel.active{display:block}
    label{display:block;font-size:13px;color:#C9A227;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
    input{width:100%;padding:12px 14px;background:#111;border:1px solid #444;border-radius:8px;color:#fff;font-size:16px;margin-bottom:20px;outline:none}
    input:focus{border-color:#C9A227}
    button{width:100%;padding:14px;background:#C9A227;color:#111;font-size:16px;font-weight:bold;border:none;border-radius:8px;cursor:pointer;letter-spacing:.05em}
    button:hover{background:#e0b82e}
    .msg{margin-top:20px;padding:14px;border-radius:8px;font-size:14px;text-align:center;display:none}
    .msg.success{background:#0d3321;color:#4caf82;border:1px solid #1a5c3a;display:block}
    .msg.error{background:#3a1010;color:#e57373;border:1px solid #7a2020;display:block}
    .msg.warn{background:#3a2e10;color:#e5c373;border:1px solid #7a6820;display:block}
    .warn-btns{display:flex;gap:10px;margin-top:12px;justify-content:center}
    .warn-btns button{width:auto;padding:10px 20px;font-size:14px}
    .btn-secondary{background:transparent;color:#C9A227;border:1px solid #C9A227}
    .btn-secondary:hover{background:#C9A22722}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <h1>SPC COMMUNITY CARD</h1>
      <p>Singapore Poker Championships</p>
    </div>
    <div class="tabs">
      <div class="tab active" onclick="switchTab('register')">Register</div>
      <div class="tab" onclick="switchTab('resend')">Resend My Card</div>
    </div>
    <div id="registerPanel" class="panel active">
      <form id="regForm">
        <label>Full Name</label>
        <input type="text" id="name" placeholder="Your full name" required/>
        <label>Email Address</label>
        <input type="email" id="email" placeholder="your@email.com" required/>
        <div style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true">
          <input type="text" id="website" name="website" tabindex="-1" autocomplete="off"/>
        </div>
        <label>Country</label>
        <div style="position:relative">
          <input type="text" id="country" placeholder="Start typing your country..." required autocomplete="off"/>
          <input type="hidden" id="countryCode"/>
          <div id="countryDrop" style="display:none;position:absolute;top:100%;left:0;right:0;background:#1a1a1a;border:1px solid #C9A227;border-radius:0 0 8px 8px;max-height:180px;overflow-y:auto;z-index:10"></div>
        </div>
        <button type="submit" id="btn">Get My Card</button>
      </form>
      <div class="msg" id="msg"></div>
    </div>
    <div id="resendPanel" class="panel">
      <form id="resendForm">
        <label>Email Address</label>
        <input type="email" id="resendEmail" placeholder="your@email.com" required/>
        <button type="submit" id="resendBtn">Resend My Card</button>
      </form>
      <div class="msg" id="resendMsg"></div>
    </div>
  </div>
  <script>
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach((t,i) => {
        t.classList.toggle('active', (tab==='register' && i===0) || (tab==='resend' && i===1));
      });
      document.getElementById('registerPanel').classList.toggle('active', tab==='register');
      document.getElementById('resendPanel').classList.toggle('active', tab==='resend');
      document.getElementById('msg').className = 'msg';
      document.getElementById('resendMsg').className = 'msg';
    }

    const countries=[['AF','Afghanistan'],['AL','Albania'],['DZ','Algeria'],['AR','Argentina'],['AU','Australia'],['AT','Austria'],['BD','Bangladesh'],['BE','Belgium'],['BR','Brazil'],['BN','Brunei'],['KH','Cambodia'],['CA','Canada'],['CN','China'],['CO','Colombia'],['HR','Croatia'],['CZ','Czech Republic'],['DK','Denmark'],['EG','Egypt'],['FI','Finland'],['FR','France'],['DE','Germany'],['GR','Greece'],['HK','Hong Kong'],['HU','Hungary'],['IN','India'],['ID','Indonesia'],['IR','Iran'],['IQ','Iraq'],['IE','Ireland'],['IL','Israel'],['IT','Italy'],['JP','Japan'],['JO','Jordan'],['KZ','Kazakhstan'],['KE','Kenya'],['KR','South Korea'],['KW','Kuwait'],['LA','Laos'],['LB','Lebanon'],['MY','Malaysia'],['MV','Maldives'],['MX','Mexico'],['MN','Mongolia'],['MM','Myanmar'],['NP','Nepal'],['NL','Netherlands'],['NZ','New Zealand'],['NG','Nigeria'],['NO','Norway'],['PK','Pakistan'],['PS','Palestine'],['PH','Philippines'],['PL','Poland'],['PT','Portugal'],['QA','Qatar'],['RO','Romania'],['RU','Russia'],['SA','Saudi Arabia'],['SG','Singapore'],['ZA','South Africa'],['ES','Spain'],['LK','Sri Lanka'],['SE','Sweden'],['CH','Switzerland'],['TW','Taiwan'],['TH','Thailand'],['TR','Turkey'],['UA','Ukraine'],['AE','UAE'],['GB','United Kingdom'],['US','United States'],['VN','Vietnam']];

    const countryInput = document.getElementById('country');
    const countryCode = document.getElementById('countryCode');
    const countryDrop = document.getElementById('countryDrop');

    countryInput.addEventListener('input', function() {
      const q = this.value.toLowerCase();
      countryCode.value = '';
      if (q.length < 1) { countryDrop.style.display='none'; return; }
      const matches = countries.filter(c => c[1].toLowerCase().includes(q)).slice(0,8);
      if (matches.length === 0) { countryDrop.style.display='none'; return; }
      countryDrop.innerHTML = matches.map(c =>
        '<div style="padding:10px 14px;cursor:pointer;font-size:14px;color:#fff;border-bottom:1px solid #333" onmouseover="this.style.background=\\'#C9A22733\\'" onmouseout="this.style.background=\\'transparent\\'" onmousedown="pickCountry(\\'' + c[0] + '\\',\\'' + c[1] + '\\')">' + c[1] + '</div>'
      ).join('');
      countryDrop.style.display='block';
    });

    countryInput.addEventListener('blur', () => { setTimeout(()=>countryDrop.style.display='none', 200); });

    function pickCountry(code, name) {
      countryInput.value = name;
      countryCode.value = code;
      countryDrop.style.display = 'none';
    }

    let pendingName = '';
    let pendingEmail = '';
    let pendingCountry = '';

    document.getElementById('regForm').addEventListener('submit', async e => {
      e.preventDefault();
      const cc = document.getElementById('countryCode').value;
      if (!cc) { document.getElementById('msg').textContent='Please select a country from the dropdown.'; document.getElementById('msg').className='msg error'; return; }
      pendingName = document.getElementById('name').value.trim();
      pendingEmail = document.getElementById('email').value.trim();
      pendingCountry = cc;
      await doRegister(pendingName, pendingEmail, pendingCountry, false);
    });

    async function doRegister(name, email, country, forceNew) {
      const btn = document.getElementById('btn');
      const msg = document.getElementById('msg');
      btn.textContent = 'Sending...';
      btn.disabled = true;
      msg.className = 'msg';
      msg.innerHTML = '';
      try {
        const res = await fetch('/register', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ name, email, forceNew, country, website: document.getElementById('website').value })
        });
        const data = await res.json();
        if (res.ok) {
          msg.textContent = '\\u2713 Your card has been sent! Check your email and save the image to your Photos.';
          msg.className = 'msg success';
          document.getElementById('regForm').reset();
        } else if (res.status === 409 && data.duplicateName) {
          msg.innerHTML = data.error + '<div class="warn-btns"><button class="btn-secondary" onclick="resendExisting()">Resend existing card</button><button onclick="registerAnyway()">Register as new</button></div>';
          msg.className = 'msg warn';
        } else {
          msg.textContent = data.error || 'Something went wrong. Please try again.';
          msg.className = 'msg error';
        }
      } catch {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'msg error';
      }
      btn.textContent = 'Get My Card';
      btn.disabled = false;
    }

    async function registerAnyway() {
      await doRegister(pendingName, pendingEmail, pendingCountry, true);
    }

    async function resendExisting() {
      switchTab('resend');
    }

    document.getElementById('resendForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('resendBtn');
      const msg = document.getElementById('resendMsg');
      const email = document.getElementById('resendEmail').value.trim();
      btn.textContent = 'Sending...';
      btn.disabled = true;
      msg.className = 'msg';
      try {
        const res = await fetch('/resend-card', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
          msg.textContent = '\\u2713 Your card has been resent! Check your email.';
          msg.className = 'msg success';
          document.getElementById('resendForm').reset();
        } else {
          msg.textContent = data.error || 'Something went wrong. Please try again.';
          msg.className = 'msg error';
        }
      } catch {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'msg error';
      }
      btn.textContent = 'Resend My Card';
      btn.disabled = false;
    });
  </script>
</body>
</html>`);
});

// Registration endpoint
app.post('/register', async (req, res) => {
  const { name, email, forceNew, country, website } = req.body;
  // Honeypot — bots fill this hidden field, humans don't
  if (website) return res.status(200).json({ success: true, memberId: 'SPC-00000' });
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });

  try {
    // Check for existing email
    const { data: existingEmail } = await supabase
      .from('members')
      .select('member_id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingEmail) {
      return res.status(409).json({ error: 'This email is already registered. Use the "Resend My Card" tab to get your card again.' });
    }

    // Check for duplicate name (unless player confirmed they want a new registration)
    if (!forceNew) {
      const { data: sameName } = await supabase
        .from('members')
        .select('name, member_id, email')
        .ilike('name', name.trim());

      if (sameName && sameName.length > 0) {
        // If existing record has no ID yet and no email, offer to merge
        const unregistered = sameName.find(m => !m.member_id && !m.email);
        if (unregistered) {
          // Auto-merge: assign ID and email to existing record
          const memberId = await generateMemberId();
          const { error: updateError } = await supabase.from('members')
            .update({
              email: email.toLowerCase().trim(),
              member_id: memberId,
              country: (country || '').toUpperCase() || null,
            })
            .ilike('name', name.trim())
            .is('member_id', null);
          if (updateError) throw updateError;
          const cardBuffer = await generateCard(name.trim(), memberId, (country || '').toUpperCase());
          await sendWelcomeEmail(name.trim(), email.trim(), memberId, cardBuffer);
          return res.json({ success: true, memberId });
        }
        // Name exists but already has an account — warn
        return res.status(409).json({
          error: 'A member named "' + name.trim() + '" already exists. Is this you? If so, resend your existing card. If you are a different person with the same name, register as new.',
          duplicateName: true,
        });
      }
    }

    // New player — create fresh record
    const memberId = await generateMemberId();
    const { error: insertError } = await supabase.from('members').insert({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      member_id: memberId,
      country: (country || '').toUpperCase() || null,
    });
    if (insertError) throw insertError;

    // Generate card and send email
    const cardBuffer = await generateCard(name.trim(), memberId, (country || '').toUpperCase());
    await sendWelcomeEmail(name.trim(), email.trim(), memberId, cardBuffer);

    return res.json({ success: true, memberId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Resend card endpoint
app.post('/resend-card', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const { data: member } = await supabase
      .from('members')
      .select('name, member_id, country')
      .eq('email', email.toLowerCase())
      .single();

    if (!member) {
      return res.status(404).json({ error: 'No card found for this email. Try registering first.' });
    }

    const cardBuffer = await generateCard(member.name, member.member_id, member.country || '');
    await sendResendEmail(member.name, email.trim(), member.member_id, cardBuffer);

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Staff stats endpoint
app.get('/staff/stats', async (req, res) => {
  try {
    const { count: total } = await supabase.from('members').select('*', { count: 'exact', head: true });
    const { count: delivered } = await supabase.from('members').select('*', { count: 'exact', head: true }).not('email', 'is', null);
    res.json({ total: total || 0, delivered: delivered || 0, pending: (total || 0) - (delivered || 0) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// Staff: find unused IDs (gaps in sequence)
app.get('/staff/unused-ids', async (req, res) => {
  try {
    const [{ data: members }, { data: withheld }] = await Promise.all([
      supabase.from('members').select('member_id').not('member_id', 'is', null),
      supabase.from('withheld_ids').select('member_id'),
    ]);

    const used = new Set((members || []).map(m => m.member_id));
    const withheldSet = new Set((withheld || []).map(w => w.member_id));
    const nums = (members || []).map(m => parseInt(m.member_id.replace('SPC-', ''), 10)).filter(n => !isNaN(n));
    const highest = nums.length ? Math.max(...nums) : 0;

    const unused = [];
    for (let i = 1; i <= highest; i++) {
      const id = 'SPC-' + String(i).padStart(5, '0');
      if (!used.has(id)) unused.push({ id, withheld: withheldSet.has(id) });
    }
    res.json({
      unused,
      withheld: Array.from(withheldSet),
      highest: 'SPC-' + String(highest).padStart(5, '0'),
      next: 'SPC-' + String(highest + 1).padStart(5, '0'),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check unused IDs.' });
  }
});

// Staff API: withhold an ID
app.post('/staff/withhold', async (req, res) => {
  const { pw, member_id } = req.body;
  if (pw !== process.env.STAFF_PW) return res.status(401).json({ error: 'Invalid password.' });
  if (!member_id || !/^SPC-\d{5}$/.test(member_id)) return res.status(400).json({ error: 'Invalid ID format.' });

  // Can't withhold an already-assigned ID
  const { data: existing } = await supabase.from('members').select('name').eq('member_id', member_id).single();
  if (existing) return res.status(409).json({ error: member_id + ' is already assigned to ' + existing.name + '.' });

  const { error } = await supabase.from('withheld_ids').upsert({ member_id });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Staff API: release a withheld ID
app.post('/staff/release', async (req, res) => {
  const { pw, member_id } = req.body;
  if (pw !== process.env.STAFF_PW) return res.status(401).json({ error: 'Invalid password.' });
  if (!member_id) return res.status(400).json({ error: 'Member ID required.' });

  const { error } = await supabase.from('withheld_ids').delete().eq('member_id', member_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Staff lookup endpoint — search by name or member ID
app.get('/lookup', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ members: [] });

  const { data } = await supabase
    .from('members')
    .select('name, email, member_id, country, created_at')
    .or(`name.ilike.%${q}%,member_id.ilike.%${q}%`)
    .limit(20);

  res.json({ members: data || [] });
});

// Staff API: update member
app.post('/staff/update', async (req, res) => {
  const { pw, member_id, name, email, country, new_member_id } = req.body;
  if (pw !== process.env.STAFF_PW) return res.status(401).json({ error: 'Invalid password.' });
  if (!member_id) return res.status(400).json({ error: 'Member ID required.' });

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (email !== undefined) updates.email = email.trim() || null;
  if (country !== undefined) updates.country = country.trim().toUpperCase() || null;
  if (new_member_id && new_member_id !== member_id) {
    // Validate format
    if (!/^SPC-\d{5}$/.test(new_member_id)) return res.status(400).json({ error: 'Invalid ID format. Must be SPC-XXXXX.' });
    // Check if new ID is already taken
    const { data: existing } = await supabase.from('members').select('member_id').eq('member_id', new_member_id).single();
    if (existing) return res.status(409).json({ error: new_member_id + ' is already assigned to another member.' });
    updates.member_id = new_member_id;
  }

  const { error } = await supabase.from('members').update(updates).eq('member_id', member_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Staff API: unassign single member ID
app.post('/staff/unassign', async (req, res) => {
  const { pw, member_id } = req.body;
  if (pw !== process.env.STAFF_PW) return res.status(401).json({ error: 'Invalid password.' });
  if (!member_id) return res.status(400).json({ error: 'Member ID required.' });

  const { error } = await supabase.from('members')
    .update({ member_id: null })
    .eq('member_id', member_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Staff API: bulk unassign member IDs
app.post('/staff/unassign-bulk', async (req, res) => {
  const { pw, member_ids } = req.body;
  if (pw !== process.env.STAFF_PW) return res.status(401).json({ error: 'Invalid password.' });
  if (!member_ids || !member_ids.length) return res.status(400).json({ error: 'No IDs provided.' });

  const { error } = await supabase.from('members')
    .update({ member_id: null })
    .in('member_id', member_ids);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, count: member_ids.length });
});

// Staff API: delete member
app.post('/staff/delete', async (req, res) => {
  const { pw, member_id } = req.body;
  if (pw !== process.env.STAFF_PW) return res.status(401).json({ error: 'Invalid password.' });
  if (!member_id) return res.status(400).json({ error: 'Member ID required.' });

  const { error } = await supabase.from('members').delete().eq('member_id', member_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Staff lookup page (password-protected)
app.get('/staff', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>SPC Staff Lookup</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#111;color:#fff;font-family:Arial,sans-serif;min-height:100vh;padding:32px 24px}
    h1{color:#C9A227;font-size:20px;letter-spacing:.08em;margin-bottom:24px}
    .login-box{max-width:360px;margin:80px auto;text-align:center}
    .login-box h1{margin-bottom:16px}
    .login-box p{color:#888;font-size:13px;margin-bottom:20px}
    input{width:100%;max-width:480px;padding:12px 16px;background:#1a1a1a;border:1px solid #444;border-radius:8px;color:#fff;font-size:16px;outline:none;margin-bottom:16px}
    input:focus{border-color:#C9A227}
    button{padding:10px 20px;background:#C9A227;color:#111;font-size:14px;font-weight:bold;border:none;border-radius:8px;cursor:pointer}
    button:hover{background:#e0b82e}
    .main{display:none}
    table{width:100%;max-width:900px;border-collapse:collapse;font-size:14px}
    th{text-align:left;color:#C9A227;padding:8px 12px;border-bottom:1px solid #333;letter-spacing:.06em;font-size:12px;text-transform:uppercase}
    td{padding:8px 12px;border-bottom:1px solid #222;color:#ddd}
    tr:hover td{background:#1a1a1a}
    .empty{color:#666;font-size:14px;margin-top:16px}
    .btn-sm{padding:5px 12px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600}
    .btn-edit{background:#2a4a3a;color:#7adf8a}
    .btn-edit:hover{background:#3a5a4a}
    .btn-del{background:#3a1a1a;color:#e57373}
    .btn-del:hover{background:#5a2a2a}
    .btn-save{background:#C9A227;color:#111}
    .btn-cancel{background:#333;color:#ccc}
    .edit-input{background:#222;border:1px solid #555;color:#fff;padding:6px 10px;border-radius:6px;font-size:14px;width:100%}
    .edit-input:focus{border-color:#C9A227;outline:none}
    .actions{display:flex;gap:6px}
    .msg{padding:10px;border-radius:6px;font-size:13px;margin-bottom:16px;display:none}
    .msg.success{display:block;background:#0d3321;color:#4caf82;border:1px solid #1a5c3a}
    .msg.error{display:block;background:#3a1010;color:#e57373;border:1px solid #7a2020}
  </style>
</head>
<body>
  <div id="loginView" class="login-box">
    <h1>SPC STAFF</h1>
    <p>Enter staff password to continue</p>
    <input type="password" id="pwInput" placeholder="Password" />
    <br/>
    <button onclick="doLogin()">Enter</button>
    <div class="msg" id="loginMsg"></div>
  </div>
  <div id="mainView" class="main">
    <h1>SPC STAFF LOOKUP</h1>
    <div id="statsRow" style="display:flex;gap:16px;margin-bottom:24px;max-width:600px">
      <div style="flex:1;background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:14px 18px;text-align:center">
        <div style="font-size:11px;color:#C9A227;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Total Members</div>
        <div id="statTotal" style="font-size:28px;font-weight:bold;color:#fff">—</div>
      </div>
      <div style="flex:1;background:#0d2a1a;border:1px solid #1a5c3a;border-radius:10px;padding:14px 18px;text-align:center">
        <div style="font-size:11px;color:#4caf82;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Cards Delivered</div>
        <div id="statDelivered" style="font-size:28px;font-weight:bold;color:#4caf82">—</div>
      </div>
      <div style="flex:1;background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:14px 18px;text-align:center">
        <div style="font-size:11px;color:#888;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Not Yet Registered</div>
        <div id="statPending" style="font-size:28px;font-weight:bold;color:#888">—</div>
      </div>
    </div>
    <input type="text" id="search" placeholder="Search by name or Player ID..." />
    <div style="margin-bottom:16px">
      <button onclick="showUnused()" style="padding:8px 16px;background:#1a1a1a;color:#C9A227;border:1px solid #C9A227;border-radius:8px;font-size:13px;cursor:pointer">Show Unused IDs</button>
      <span id="unusedInfo" style="font-size:13px;color:#888;margin-left:12px"></span>
    </div>
    <div id="unusedList" style="display:none;margin-bottom:20px;padding:14px;background:#1a1a1a;border:1px solid #333;border-radius:8px;max-width:600px">
      <div style="font-size:12px;color:#C9A227;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Unused Player IDs</div>
      <div id="unusedIds" style="font-size:14px;color:#ddd;line-height:1.8"></div>
    </div>
    <div class="msg" id="actionMsg"></div>
    <div id="bulkBar" style="display:none;margin-bottom:12px;padding:10px 14px;background:#1a1a1a;border:1px solid #555;border-radius:8px;display:none;align-items:center;gap:12px;max-width:900px">
      <span id="bulkCount" style="font-size:13px;color:#ccc"></span>
      <button class="btn-sm btn-edit" onclick="unassignSelected()">Unassign Selected IDs</button>
      <button class="btn-sm btn-del" onclick="deleteSelected()">Delete Selected</button>
      <button class="btn-sm btn-cancel" onclick="clearSelection()">Clear Selection</button>
    </div>
    <table id="results" style="display:none">
      <thead><tr>
        <th><input type="checkbox" id="selectAll" onchange="toggleSelectAll(this)"/></th>
        <th>Player ID</th><th>Name</th><th>Country</th><th>Email</th><th>Registered</th><th>Actions</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
    <p class="empty" id="empty" style="display:none">No members found.</p>
  </div>
  <script>
    let staffPw = '';
    let editingId = null;

    function doLogin() {
      staffPw = document.getElementById('pwInput').value;
      if (!staffPw) return;
      document.getElementById('loginView').style.display = 'none';
      document.getElementById('mainView').style.display = 'block';
      document.getElementById('search').focus();
      loadStats();
    }

    async function loadStats() {
      try {
        const res = await fetch('/staff/stats');
        const s = await res.json();
        document.getElementById('statTotal').textContent = s.total;
        document.getElementById('statDelivered').textContent = s.delivered;
        document.getElementById('statPending').textContent = s.pending;
      } catch(e) {}
    }
    document.getElementById('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    let timer;
    document.getElementById('search').addEventListener('input', e => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      if (q.length < 2) { document.getElementById('results').style.display='none'; document.getElementById('empty').style.display='none'; return; }
      timer = setTimeout(() => doSearch(q), 300);
    });

    async function doSearch(q) {
      const res = await fetch('/lookup?q=' + encodeURIComponent(q));
      const data = await res.json();
      renderTable(data.members);
    }

    let selectedIds = new Set();

    function toggleSelectAll(cb) {
      document.querySelectorAll('.row-check').forEach(c => {
        c.checked = cb.checked;
        if (cb.checked && c.dataset.id) selectedIds.add(c.dataset.id);
        else if (c.dataset.id) selectedIds.delete(c.dataset.id);
      });
      updateBulkBar();
    }

    function toggleRow(cb) {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
      updateBulkBar();
    }

    function updateBulkBar() {
      const bar = document.getElementById('bulkBar');
      if (selectedIds.size > 0) {
        bar.style.display = 'flex';
        document.getElementById('bulkCount').textContent = selectedIds.size + ' selected';
      } else {
        bar.style.display = 'none';
      }
    }

    function clearSelection() {
      selectedIds.clear();
      document.querySelectorAll('.row-check').forEach(c => c.checked = false);
      const sa = document.getElementById('selectAll');
      if (sa) sa.checked = false;
      updateBulkBar();
    }

    function renderTable(members) {
      const tbody = document.getElementById('tbody');
      tbody.innerHTML = '';
      if (members.length === 0) {
        document.getElementById('results').style.display='none';
        document.getElementById('empty').style.display='block';
      } else {
        document.getElementById('empty').style.display='none';
        document.getElementById('results').style.display='table';
        members.forEach(m => {
          const d = m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB') : '—';
          const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          const chkId = m.member_id || '';
          const checked = selectedIds.has(chkId) ? 'checked' : '';
          if (editingId === m.member_id) {
            tbody.innerHTML += '<tr>' +
              '<td><input type="checkbox" class="row-check" data-id="' + esc(chkId) + '" onchange="toggleRow(this)" ' + checked + '/></td>' +
              '<td><input class="edit-input" id="editMemberId" value="' + esc(m.member_id||'') + '" style="width:110px" placeholder="SPC-XXXXX"/></td>' +
              '<td><input class="edit-input" id="editName" value="' + esc(m.name) + '" /></td>' +
              '<td><input class="edit-input" id="editCountry" value="' + esc(m.country||'') + '" style="width:60px" /></td>' +
              '<td><input class="edit-input" id="editEmail" value="' + esc(m.email||'') + '" /></td>' +
              '<td>' + d + '</td>' +
              '<td><div class="actions"><button class="btn-sm btn-save" onclick="saveEdit(\\'' + esc(m.member_id||'') + '\\')">Save</button><button class="btn-sm btn-cancel" onclick="cancelEdit()">Cancel</button></div></td>' +
              '</tr>';
          } else {
            const idDisplay = m.member_id ? esc(m.member_id) : '<span style="color:#555;font-style:italic">Unassigned</span>';
            tbody.innerHTML += '<tr>' +
              '<td><input type="checkbox" class="row-check" data-id="' + esc(chkId) + '" onchange="toggleRow(this)" ' + checked + (chkId ? '' : ' disabled') + '/></td>' +
              '<td>' + idDisplay + '</td>' +
              '<td>' + esc(m.name) + '</td>' +
              '<td>' + (m.country ? '<img src="https://flagcdn.com/w20/' + m.country.toLowerCase() + '.png" style="vertical-align:middle;margin-right:4px"/>' + esc(m.country) : '—') + '</td>' +
              '<td>' + esc(m.email||'—') + '</td>' +
              '<td>' + d + '</td>' +
              '<td><div class="actions">' +
              '<button class="btn-sm btn-edit" onclick="startEdit(\\'' + esc(m.member_id||'') + '\\', \\'' + esc(m.name) + '\\')">Edit</button>' +
              (m.member_id ? '<button class="btn-sm" style="background:#2a2a10;color:#e5d060;border:none;cursor:pointer" onclick="unassignOne(\\'' + esc(m.member_id) + '\\')">Unassign</button>' : '') +
              '<button class="btn-sm btn-del" onclick="deleteMember(\\'' + esc(m.member_id||'') + '\\', \\'' + esc(m.name) + '\\')">Delete</button>' +
              '</div></td>' +
              '</tr>';
          }
        });
      }
    }

    async function unassignOne(mid) {
      if (!confirm('Unassign ' + mid + '? The player name will be kept but the ID will be released back into the pool.')) return;
      const res = await fetch('/staff/unassign', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pw: staffPw, member_id: mid })
      });
      const data = await res.json();
      if (res.ok) { showMsg(mid + ' unassigned.', 'success'); doSearch(document.getElementById('search').value.trim()); loadStats(); }
      else showMsg(data.error || 'Unassign failed.', 'error');
    }

    async function unassignSelected() {
      const ids = Array.from(selectedIds).filter(Boolean);
      if (!ids.length) return;
      if (!confirm('Unassign ' + ids.length + ' Player ID(s)? Names will be kept, IDs released.')) return;
      const res = await fetch('/staff/unassign-bulk', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pw: staffPw, member_ids: ids })
      });
      const data = await res.json();
      if (res.ok) { showMsg(data.count + ' IDs unassigned.', 'success'); clearSelection(); doSearch(document.getElementById('search').value.trim()); loadStats(); }
      else showMsg(data.error || 'Bulk unassign failed.', 'error');
    }

    async function deleteSelected() {
      const ids = Array.from(selectedIds).filter(Boolean);
      if (!ids.length) return;
      if (!confirm('Permanently delete ' + ids.length + ' member(s)? This cannot be undone.')) return;
      let deleted = 0;
      for (const mid of ids) {
        const res = await fetch('/staff/delete', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ pw: staffPw, member_id: mid })
        });
        if (res.ok) deleted++;
      }
      showMsg(deleted + ' member(s) deleted.', 'success');
      clearSelection();
      doSearch(document.getElementById('search').value.trim());
      loadStats();
    }

    function startEdit(mid, name) {
      editingId = mid || name;
      doSearch(document.getElementById('search').value.trim());
    }

    function cancelEdit() {
      editingId = null;
      doSearch(document.getElementById('search').value.trim());
    }

    async function saveEdit(mid) {
      const newMid = document.getElementById('editMemberId').value.trim().toUpperCase();
      const name = document.getElementById('editName').value.trim();
      const email = document.getElementById('editEmail').value.trim();
      const country = document.getElementById('editCountry').value.trim().toUpperCase();
      if (!name) { showMsg('Name cannot be empty.', 'error'); return; }
      if (!newMid || !/^SPC-\\d{5}$/.test(newMid)) { showMsg('Player ID must be SPC-XXXXX format.', 'error'); return; }
      const res = await fetch('/staff/update', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pw: staffPw, member_id: mid, name, email, country, new_member_id: newMid })
      });
      const data = await res.json();
      if (res.ok) {
        editingId = null;
        showMsg('Updated ' + mid + ' successfully.', 'success');
        doSearch(document.getElementById('search').value.trim());
        loadStats();
      } else {
        showMsg(data.error || 'Update failed.', 'error');
      }
    }

    async function deleteMember(mid, name) {
      if (!confirm('Delete ' + name + ' (' + mid + ')? This cannot be undone.')) return;
      const res = await fetch('/staff/delete', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pw: staffPw, member_id: mid })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('Deleted ' + mid + ' (' + name + ').', 'success');
        doSearch(document.getElementById('search').value.trim());
        loadStats();
      } else {
        showMsg(data.error || 'Delete failed.', 'error');
      }
    }

    function showMsg(text, type) {
      const el = document.getElementById('actionMsg');
      el.textContent = text;
      el.className = 'msg ' + type;
      setTimeout(() => { el.className = 'msg'; }, 4000);
    }

    async function showUnused() {
      document.getElementById('unusedInfo').textContent = 'Loading...';
      try {
        const res = await fetch('/staff/unused-ids');
        const data = await res.json();
        const list = document.getElementById('unusedList');
        const ids = document.getElementById('unusedIds');

        document.getElementById('unusedInfo').textContent =
          (data.unused.length || 0) + ' gap(s) · ' +
          (data.withheld.length || 0) + ' withheld · Next available: ' + data.next;

        if (data.unused.length === 0 && data.withheld.length === 0) {
          list.style.display = 'none';
        } else {
          list.style.display = 'block';
          // Withheld section
          let html = '';
          if (data.withheld.length > 0) {
            html += '<div style="margin-bottom:10px"><span style="font-size:11px;color:#e5d060;letter-spacing:.08em;text-transform:uppercase">Withheld IDs</span><br/>';
            html += data.withheld.sort().map(id =>
              '<span style="display:inline-flex;align-items:center;gap:6px;background:#2a2a10;padding:4px 10px;border-radius:4px;margin:3px 4px;font-family:monospace;font-size:13px">' +
              id + '<button onclick="releaseId(\\'' + id + '\\')" style="background:none;border:none;color:#4caf82;cursor:pointer;font-size:11px;padding:0">Release</button></span>'
            ).join('');
            html += '</div>';
          }
          // Gap IDs section
          const gaps = data.unused.filter(u => !u.withheld);
          if (gaps.length > 0) {
            html += '<div><span style="font-size:11px;color:#888;letter-spacing:.08em;text-transform:uppercase">Gap IDs (unassigned)</span><br/>';
            html += gaps.map(u =>
              '<span style="display:inline-flex;align-items:center;gap:6px;background:#222;padding:4px 10px;border-radius:4px;margin:3px 4px;font-family:monospace;font-size:13px">' +
              u.id + '<button onclick="withholdId(\\'' + u.id + '\\')" style="background:none;border:none;color:#e5d060;cursor:pointer;font-size:11px;padding:0">Withhold</button></span>'
            ).join('');
            html += '</div>';
          }
          // Withhold a specific ID input
          html += '<div style="margin-top:12px;display:flex;gap:8px;align-items:center">' +
            '<input id="withholdInput" type="text" placeholder="SPC-XXXXX" style="width:120px;padding:6px 10px;background:#222;border:1px solid #555;border-radius:6px;color:#fff;font-size:13px;font-family:monospace"/>' +
            '<button class="btn-sm" style="background:#2a2a10;color:#e5d060;border:1px solid #555;cursor:pointer" onclick="withholdFromInput()">Withhold ID</button>' +
            '</div>';
          ids.innerHTML = html;
          list.style.display = 'block';
        }
      } catch(e) {
        document.getElementById('unusedInfo').textContent = 'Failed to load.';
      }
    }

    async function withholdId(id) {
      const res = await fetch('/staff/withhold', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pw: staffPw, member_id: id })
      });
      const data = await res.json();
      if (res.ok) showUnused();
      else showMsg(data.error || 'Failed to withhold.', 'error');
    }

    async function withholdFromInput() {
      const id = document.getElementById('withholdInput').value.trim().toUpperCase();
      if (!id) return;
      await withholdId(id);
    }

    async function releaseId(id) {
      const res = await fetch('/staff/release', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pw: staffPw, member_id: id })
      });
      const data = await res.json();
      if (res.ok) showUnused();
      else showMsg(data.error || 'Failed to release.', 'error');
    }
  </script>
</body>
</html>`);
});

// ── TOURNAMENT RESULTS API ─────────────────────────────────────────────
// POST /api/tournament — receives full tournament data from TD app on POTY commit
app.post('/api/tournament', async (req, res) => {
  const { tournament, results, device, series } = req.body;
  if (!tournament || !tournament.id) return res.status(400).json({ error: 'Missing tournament data' });
  if (!Array.isArray(results)) return res.status(400).json({ error: 'Results must be an array' });

  try {
    // Idempotent: upsert tournament, then replace results
    const tournamentRow = {
      id: tournament.id,
      name: tournament.name || 'Unnamed',
      event_type: tournament.eventType || null,
      date: tournament.date || new Date().toISOString(),
      buyin: tournament.buyin || 0,
      prize_pool: tournament.prizePool || 0,
      entries: tournament.entries || 0,
      guarantee: tournament.guarantee || 0,
      hit_guarantee: tournament.hitGuarantee || false,
      structure: tournament.structure || null,
      spc_series: series || tournament.series || null,
      committed_at: new Date().toISOString(),
      committed_by_device: device || null,
      raw_data: tournament.rawData || null,
    };

    const { error: tErr } = await supabase.from('tournaments').upsert(tournamentRow);
    if (tErr) throw tErr;

    // Wipe existing results for this tournament and re-insert (idempotent)
    await supabase.from('tournament_results').delete().eq('tournament_id', tournament.id);

    if (results.length > 0) {
      const resultRows = results.map(r => ({
        tournament_id: tournament.id,
        member_id: r.memberId || null,
        player_name: r.name,
        country: r.country || null,
        bust_position: r.bustPosition || null,
        payout_amount: r.payoutAmount || 0,
        extra_bag_amount: r.extraBagAmount || 0,
        total_prize: r.totalPrize || 0,
        poty_points: r.potyPoints || 0,
        reentry_count: r.reentryCount || 0,
      }));
      const { error: rErr } = await supabase.from('tournament_results').insert(resultRows);
      if (rErr) throw rErr;
    }

    res.json({ success: true, tournament_id: tournament.id, results_count: results.length });
  } catch (err) {
    console.error('Tournament push error:', err);
    res.status(500).json({ error: err.message || 'Failed to save tournament' });
  }
});

// GET /api/tournaments — list all tournaments (most recent first)
app.get('/api/tournaments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .order('date', { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json({ tournaments: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournament/:id — single tournament with all results
app.get('/api/tournament/:id', async (req, res) => {
  try {
    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (tErr) throw tErr;

    const { data: results, error: rErr } = await supabase
      .from('tournament_results')
      .select('*')
      .eq('tournament_id', req.params.id)
      .order('bust_position', { ascending: true, nullsFirst: false });
    if (rErr) throw rErr;

    res.json({ tournament, results: results || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint for TD app to sync full member list
app.get('/api/members', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('members')
      .select('name, member_id, country')
      .order('member_id', { ascending: true });

    if (error) throw error;
    res.json({ members: data || [], syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch members.' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`SPC Members server running on port ${process.env.PORT || 3000}`);
});
