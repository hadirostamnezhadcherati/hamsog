const tokenKey = 'hamsog_admin_token';
const loginCard = document.getElementById('loginCard');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const leadsList = document.getElementById('leadsList');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const totalCount = document.getElementById('totalCount');
const newCount = document.getElementById('newCount');
const soldCount = document.getElementById('soldCount');
const cardNumberInput = document.getElementById('cardNumberInput');
const amountInput = document.getElementById('amountInput');
const smsTemplateInput = document.getElementById('smsTemplateInput');
const savePaymentSettingsBtn = document.getElementById('savePaymentSettingsBtn');
const paymentSettingsMessage = document.getElementById('paymentSettingsMessage');
const statuses = ['جدید', 'تماس گرفته شد', 'نیاز به تماس مجدد', 'خرید انجام شد', 'عدم پاسخ', 'لغو شد'];
let leads = [];
let paymentSettings = { cardNumber: '', amount: '', template: 'سلام {{name}} عزیز، برای تکمیل رزرو جلسه همسوگ لطفاً مبلغ {{amount}} را به شماره کارت {{cardNumber}} واریز کنید و رسید را ارسال بفرمایید. با احترام، همسوگ' };

function token(){ return localStorage.getItem(tokenKey); }
function setLoggedIn(value){ loginCard.classList.toggle('hidden', value); dashboard.classList.toggle('hidden', !value); }
function authHeaders(){ return { 'Content-Type':'application/json', 'Authorization': `Bearer ${token()}` }; }
function formatDate(iso){ try { return new Intl.DateTimeFormat('fa-IR', { dateStyle:'medium', timeStyle:'short' }).format(new Date(iso)); } catch { return iso || ''; } }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function normalizePhone(phone=''){ return String(phone).trim().replace(/[\s\-()]/g, ''); }
async function loadPaymentSettings(){
  const response = await fetch('/api/admin/settings', { headers: authHeaders() });
  if(response.status === 401){ localStorage.removeItem(tokenKey); setLoggedIn(false); return; }
  const result = await response.json();
  paymentSettings = result.settings || paymentSettings;
  cardNumberInput.value = paymentSettings.cardNumber || '';
  amountInput.value = paymentSettings.amount || '';
  smsTemplateInput.value = paymentSettings.template || '';
}
async function savePaymentSettings(){
  paymentSettingsMessage.textContent = 'در حال ذخیره...';
  paymentSettingsMessage.className = 'message';
  const payload = { cardNumber: cardNumberInput.value.trim(), amount: amountInput.value.trim(), template: smsTemplateInput.value.trim() };
  try{
    const response = await fetch('/api/admin/settings', { method:'PUT', headers:authHeaders(), body:JSON.stringify(payload) });
    const result = await response.json();
    if(!response.ok) throw new Error(result.message);
    paymentSettings = result.settings;
    paymentSettingsMessage.textContent = 'تنظیمات پیامک روی سرور ذخیره شد.';
    paymentSettingsMessage.className = 'message ok';
    renderLeads();
  }catch(err){
    paymentSettingsMessage.textContent = err.message || 'خطا در ذخیره تنظیمات.';
    paymentSettingsMessage.className = 'message err';
  }
}
function buildSmsBody(lead){
  return paymentSettings.template
    .replaceAll('{{name}}', lead.fullName || '')
    .replaceAll('{{phone}}', lead.phone || '')
    .replaceAll('{{amount}}', paymentSettings.amount || 'مبلغ جلسه')
    .replaceAll('{{cardNumber}}', paymentSettings.cardNumber || 'شماره کارت');
}
function buildSmsLink(lead){ return `sms:${encodeURIComponent(normalizePhone(lead.phone))}?body=${encodeURIComponent(buildSmsBody(lead))}`; }

loginForm.addEventListener('submit', async e => {
  e.preventDefault(); loginMessage.textContent = 'در حال ورود...'; loginMessage.className = 'message';
  try{
    const response = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries())) });
    const result = await response.json();
    if(!response.ok) throw new Error(result.message);
    localStorage.setItem(tokenKey, result.token); setLoggedIn(true); await loadPaymentSettings(); await loadLeads();
  }catch(err){ loginMessage.textContent = err.message || 'ورود ناموفق بود.'; loginMessage.className = 'message err'; }
});

document.getElementById('logoutBtn').addEventListener('click', () => { localStorage.removeItem(tokenKey); setLoggedIn(false); });
document.getElementById('refreshBtn').addEventListener('click', async () => { await loadPaymentSettings(); await loadLeads(); });
document.getElementById('exportBtn').addEventListener('click', () => { fetch('/api/admin/export.csv', {headers: {Authorization:`Bearer ${token()}`}}).then(r=>{ if(!r.ok) throw new Error(); return r.blob(); }).then(blob=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='hamsog-leads.csv';a.click();URL.revokeObjectURL(url);}).catch(()=>alert('خطا در خروجی گرفتن')); });
searchInput.addEventListener('input', renderLeads); statusFilter.addEventListener('change', renderLeads);
savePaymentSettingsBtn.addEventListener('click', savePaymentSettings);

async function loadLeads(){
  try{
    const response = await fetch('/api/admin/leads', { headers: authHeaders() });
    if(response.status === 401){ localStorage.removeItem(tokenKey); setLoggedIn(false); return; }
    const result = await response.json();
    leads = result.leads || []; renderLeads();
  }catch(err){ leadsList.innerHTML = '<div class="card empty">خطا در دریافت اطلاعات.</div>'; }
}

function renderLeads(){
  const q = searchInput.value.trim(); const st = statusFilter.value;
  const filtered = leads.filter(l => (!st || l.status === st) && (!q || [l.fullName,l.phone,l.city,l.description,l.griefType].join(' ').includes(q)));
  totalCount.textContent = leads.length; newCount.textContent = leads.filter(l=>l.status==='جدید').length; soldCount.textContent = leads.filter(l=>l.status==='خرید انجام شد').length;
  if(!filtered.length){ leadsList.innerHTML = '<div class="card empty">درخواستی برای نمایش وجود ندارد.</div>'; return; }
  leadsList.innerHTML = filtered.map(lead => `
    <article class="lead-card" data-id="${lead.id}">
      <div class="lead-top"><div><h3>${escapeHtml(lead.fullName)}</h3><a class="phone-text" href="tel:${escapeHtml(normalizePhone(lead.phone))}">${escapeHtml(lead.phone)}</a></div><span class="badge">${escapeHtml(lead.status)}</span></div>
      <div class="quick-actions">
        <a class="call-btn" href="tel:${escapeHtml(normalizePhone(lead.phone))}">تماس مستقیم</a>
        <a class="sms-btn" href="${buildSmsLink(lead)}">ارسال پیامک پیش‌فرض</a>
        <button class="copy-sms-btn" type="button">کپی متن پیامک</button>
      </div>
      <div class="lead-meta"><span>شهر: ${escapeHtml(lead.city || '—')}</span><span>نوع سوگ: ${escapeHtml(lead.griefType)}</span><span>زمان تماس: ${escapeHtml(lead.preferredTime || '—')}</span><span>فوریت: ${escapeHtml(lead.urgency || '—')}</span><span>تاریخ ثبت: ${formatDate(lead.createdAt)}</span></div>
      <div class="lead-desc">${escapeHtml(lead.description)}</div>
      <div class="lead-controls">
        <select class="statusSelect">${statuses.map(s=>`<option ${s===lead.status?'selected':''}>${s}</option>`).join('')}</select>
        <textarea class="noteInput" rows="2" placeholder="یادداشت مدیر...">${escapeHtml(lead.adminNote || '')}</textarea>
        <button class="delete-btn">حذف</button>
      </div>
    </article>`).join('');
  document.querySelectorAll('.lead-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.statusSelect').addEventListener('change', e => updateLead(id, {status:e.target.value}));
    card.querySelector('.noteInput').addEventListener('change', e => updateLead(id, {adminNote:e.target.value}));
    card.querySelector('.delete-btn').addEventListener('click', () => deleteLead(id));
    card.querySelector('.copy-sms-btn').addEventListener('click', async () => {
      const lead = leads.find(l => l.id === id);
      try{ await navigator.clipboard.writeText(buildSmsBody(lead)); alert('متن پیامک کپی شد.'); }
      catch{ alert(buildSmsBody(lead)); }
    });
  });
}

async function updateLead(id, patch){
  const response = await fetch(`/api/admin/leads/${id}`, { method:'PATCH', headers:authHeaders(), body:JSON.stringify(patch) });
  if(response.ok){ const result = await response.json(); leads = leads.map(l => l.id === id ? result.lead : l); renderLeads(); }
}
async function deleteLead(id){
  if(!confirm('این درخواست حذف شود؟')) return;
  const response = await fetch(`/api/admin/leads/${id}`, { method:'DELETE', headers:authHeaders() });
  if(response.ok){ leads = leads.filter(l => l.id !== id); renderLeads(); }
}

if(token()){ setLoggedIn(true); loadPaymentSettings().then(loadLeads); } else { setLoggedIn(false); }
