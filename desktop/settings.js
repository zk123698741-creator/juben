/* Ordinary renderer JavaScript, without Node access. */
const form = document.getElementById('form');
const status = document.getElementById('status');
window.jubenDesktop.getConfig().then(values => {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (field) field.value = value;
  }
}).catch(error => { status.textContent = error.message; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  document.getElementById('save').disabled = true;
  try {
    await window.jubenDesktop.saveConfig(Object.fromEntries(new FormData(form)));
    status.textContent = '已保存，正在重启…';
  } catch (error) {
    status.textContent = error.message;
    document.getElementById('save').disabled = false;
  }
});
