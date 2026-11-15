(() => {
  'use strict';
  const list = document.getElementById('optList');
  const tpl = document.getElementById('optTpl');
  const add = document.getElementById('addOpt');
  if (list && tpl && add) {
    add.addEventListener('click', () => { if (list.children.length < 12) list.appendChild(tpl.content.cloneNode(true)); });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.rm-opt');
      if (b && list.children.length > 2) b.closest('.opt-row').remove();
    });
  }
  const file = document.getElementById('imageInput');
  const prev = document.getElementById('imgPrev');
  if (file && prev) file.addEventListener('change', () => {
    const f = file.files[0];
    if (f) { prev.src = URL.createObjectURL(f); prev.hidden = false; }
  });
})();
