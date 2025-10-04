(async function(){
  const { openaiKey, openaiModel } = await chrome.storage.sync.get({
    openaiKey:"", openaiModel:"gpt-4o-mini"
  });
  document.getElementById('apiKey').value = openaiKey;
  document.getElementById('model').value  = openaiModel;
})();

document.getElementById('save').onclick = async () => {
  const openaiKey = document.getElementById('apiKey').value.trim();
  const openaiModel = (document.getElementById('model').value.trim()) || 'gpt-4o-mini';
  await chrome.storage.sync.set({ openaiKey, openaiModel });
  const s = document.getElementById('status'); s.textContent = 'Saved'; setTimeout(()=>s.textContent='',1500);
};
