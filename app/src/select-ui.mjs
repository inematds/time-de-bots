const chevron = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6.5 3 3 3-3"/></svg>';
const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg>';

// Keep native selects as the form/state source; render the same choices in a
// themed top-layer listbox so menus cannot be clipped by a scrolling dialog.
export function setupSelects(root = document) {
  const controls = new Map();
  function refresh() { for (const select of root.querySelectorAll('select')) {
    if (controls.has(select.id)) continue;
    const label = select.getAttribute('aria-label') || select.labels?.[0]?.firstChild?.textContent?.trim() || 'Choose an option';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.id = `${select.id}-trigger`; trigger.className = 'select-trigger';
    trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span'); value.className = 'select-value';
    const arrow = document.createElement('span'); arrow.className = 'select-chevron'; arrow.innerHTML = chevron;
    trigger.append(value, arrow);
    const menu = document.createElement('div'); menu.id = `${select.id}-menu`; menu.className = 'select-menu';
    menu.setAttribute('popover', 'auto'); menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', label);
    trigger.setAttribute('aria-controls', menu.id);
    select.classList.add('select-source'); select.setAttribute('aria-hidden', 'true'); select.tabIndex = -1;
    select.after(trigger); (select.closest('dialog') || document.body).append(menu);
    let open = false, activeIndex = 0;
    const enabled = () => [...menu.children].filter(option => !option.disabled);
    function hide() {menu.hidePopover();open = false;trigger.setAttribute('aria-expanded','false');}
    function sync() {
      value.replaceChildren();const selected=select.selectedOptions[0];if(selected?.dataset.logo){const logo=document.createElement('img');logo.className='provider-logo';logo.src=`./assets/${selected.dataset.logo}.svg`;logo.alt='';value.append(logo);}value.append(document.createTextNode(selected?.textContent||'Choose…'));
      trigger.hidden = select.hidden; trigger.disabled = select.disabled;
      trigger.title = select.title;
      if (open && (select.hidden || select.disabled || !trigger.getClientRects().length)) hide();
      for (const item of menu.children) item.setAttribute('aria-selected', String(item.dataset.value === select.value));
    }
    function place() {
      const rect = trigger.getBoundingClientRect(), gap = 6, edge = 8;
      const width = Math.min(Math.max(rect.width, select.id === 'chat-model' ? 192 : 200), innerWidth - edge * 2);
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${Math.max(80, Math.min(320, innerHeight - edge * 2))}px`;
      const height = menu.getBoundingClientRect().height;
      const below = innerHeight - rect.bottom - gap - edge, above = rect.top - gap - edge;
      const useAbove = below < height && above > below;
      menu.style.maxHeight = `${Math.max(60, Math.min(320, useAbove ? above : below))}px`;
      menu.style.left = `${Math.max(edge, Math.min(rect.right - width, innerWidth - width - edge))}px`;
      menu.style.top = `${useAbove ? Math.max(edge, rect.top - gap - menu.getBoundingClientRect().height) : rect.bottom + gap}px`;
    }
    function focusAt(index) {
      const options = enabled(); if (!options.length) return;
      activeIndex = (index + options.length) % options.length;
      options.forEach((option, i) => option.tabIndex = i === activeIndex ? 0 : -1);
      const option = options[activeIndex]; option.focus({preventScroll:true});
      const itemRect = option.getBoundingClientRect(), menuRect = menu.getBoundingClientRect();
      if (itemRect.top < menuRect.top + 5) menu.scrollTop -= menuRect.top + 5 - itemRect.top;
      else if (itemRect.bottom > menuRect.bottom - 5) menu.scrollTop += itemRect.bottom - menuRect.bottom + 5;
    }
    function show(direction = 0) {
      if (trigger.disabled || trigger.hidden) return;
      menu.replaceChildren(...[...select.options].map(option => {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'select-option'; item.setAttribute('role', 'option'); item.dataset.value = option.value; item.tabIndex = -1; item.disabled = option.disabled;
        const title = document.createElement('span'); title.className = 'select-option-label'; title.textContent = option.textContent;
        const tick = document.createElement('span'); tick.className = 'select-check'; tick.innerHTML = check; if(option.dataset.logo){const logo=document.createElement('img');logo.className='provider-logo';logo.src=`./assets/${option.dataset.logo}.svg`;logo.alt='';item.append(logo);}item.append(title, tick);
        item.addEventListener('click', () => {
          select.value = option.value; sync(); hide(); trigger.focus({preventScroll:true});
          select.dispatchEvent(new Event('input', {bubbles:true})); select.dispatchEvent(new Event('change', {bubbles:true}));
        });
        return item;
      }));
      menu.showPopover(); open = true; trigger.setAttribute('aria-expanded', 'true'); sync(); place();
      const index = enabled().findIndex(item => item.dataset.value === select.value);
      focusAt(direction < 0 ? enabled().length - 1 : Math.max(0,index));
    }
    trigger.addEventListener('click', () => open ? hide() : show());
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {event.preventDefault();show(event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1);}
    });
    let search = '', searchTimer;
    menu.addEventListener('keydown', event => {
      const index = enabled().indexOf(document.activeElement);
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); focusAt(event.key === 'Home' ? 0 : event.key === 'End' ? enabled().length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();hide();trigger.focus({preventScroll:true});}
      else if (event.key === 'Tab') {hide();trigger.focus({preventScroll:true});}
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
        event.preventDefault(); clearTimeout(searchTimer); search += event.key.toLocaleLowerCase();
        const match = enabled().findIndex(item => item.textContent.trim().toLocaleLowerCase().startsWith(search));if(match >= 0)focusAt(match);
        searchTimer = setTimeout(()=>{search='';},500);
      }
    });
    menu.addEventListener('toggle', event => {open = event.newState === 'open';trigger.setAttribute('aria-expanded',String(open));if(!open){clearTimeout(searchTimer);search='';}});
    select.addEventListener('change', sync); select.addEventListener('invalid',()=>trigger.focus());
    new MutationObserver(sync).observe(select,{attributes:true,childList:true,subtree:true});
    window.addEventListener('resize',()=>{if(open)place();});
    document.addEventListener('scroll',event=>{if(open&&!menu.contains(event.target))place();},true);
    controls.set(select.id,{sync,close:()=>hide()}); sync();
  }}
  refresh();
  return {refresh,sync:()=>controls.forEach(control=>control.sync()),close:()=>controls.forEach(control=>control.close())};
}
