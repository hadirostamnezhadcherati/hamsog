const form = document.getElementById('leadForm');
const msg = document.getElementById('formMessage');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  msg.className = 'message full';
  msg.textContent = 'در حال ثبت درخواست...';
  const data = Object.fromEntries(new FormData(form).entries());
  data.consent = form.elements.consent.checked;
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'خطا در ثبت درخواست');
    msg.className = 'message ok full';
    msg.textContent = 'درخواست شما با موفقیت ثبت شد. مشاور در اولین فرصت با شما تماس خواهد گرفت.';
    form.reset();
  } catch (error) {
    msg.className = 'message err full';
    msg.textContent = error.message || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.';
  }
});


let deferredInstallPrompt = null;
const installBtn = document.getElementById('installAppBtn');
const installBox = document.getElementById('installBox');

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installBtn) installBtn.disabled = false;
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      return;
    }
    alert('اگر نصب خودکار باز نشد، از منوی سه‌نقطه مرورگر گزینه Add to Home screen یا Install app را بزنید.');
  });
}

window.addEventListener('appinstalled', () => {
  if (installBox) installBox.classList.add('hidden');
});
