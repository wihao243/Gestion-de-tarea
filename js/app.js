/* ============================================================
   QUEST LOG — Crónicas de DAM
   Frontend Logic
   ============================================================ */

(function () {
  'use strict';

  /* ── CONFIG ──────────────────────────────────────────── */
  const API_BASE = '/api';

  /* Asignaturas → Gremios, Profesores → Dungeon Masters */
  const SUBJECTS = [
    { module: 'Programación', dm: 'Jaume', emoji: '💻' },
    { module: 'Sistemas', dm: 'Jaume', emoji: '🖥️' },
    { module: 'BBDD', dm: 'Porti', emoji: '🗄️' },
    { module: 'Módulo 1709', dm: 'Robert', emoji: '🛠️' },
    { module: 'ERP', dm: 'Gon', emoji: '🏭' },
    { module: 'Web', dm: 'Josep', emoji: '🌐' },
    { module: 'Anglès', dm: 'Gon', emoji: '🗣️' },
    { module: 'EIE', dm: 'Eli', emoji: '💼' },
    { module: 'Tutoría', dm: 'Claudina', emoji: '🧭' },
  ];
  const SUBJECT_MAP = Object.fromEntries(SUBJECTS.map(s => [s.module, s]));

  /* Enemigos → XP, daño de vencimiento */
  const ENEMY_TYPES = {
    slime:    { label: 'Bicho',     emoji: '🟢', xp: 25, damage: 5  },
    miniboss: { label: 'Minijefe',  emoji: '🟡', xp: 60, damage: 12 },
    boss:     { label: 'Jefe Final',emoji: '🔴', xp: 120, damage: 20 },
  };

  const XP_PER_LEVEL = 100;
  const HP_BASE = 100;
  const URGENT_DAYS = 3;

  /* ── STATE ───────────────────────────────────────────── */
  const state = {
    enemies: [],
    bestiary: [],
    xp: 0,
    level: 1,
    hp: HP_BASE,
    activeFilter: 'all',
    selectedType: 'slime',
  };

  /* ── DOM REFS ────────────────────────────────────────── */
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  const dom = {
    enemyList: $('#enemy-list'),
    bestiaryList: $('#bestiary-list'),
    hpBarFill: $('#hp-bar-fill'),
    hpCurrent: $('#hp-current'),
    hpMax: $('#hp-max'),
    xpBarFill: $('#xp-bar-fill'),
    xpCurrent: $('#xp-current'),
    xpNeeded: $('#xp-needed'),
    heroLevel: $('#hero-level'),
    statKills: $('#stat-kills'),
    totalDefeated: $('#total-defeated'),
    totalSlimes: $('#total-slimes'),
    totalMiniboss: $('#total-miniboss'),
    totalBoss: $('#total-boss'),
    totalXp: $('#total-xp'),
    totalHp: $('#total-hp'),
    urgentCount: $('#urgent-count'),
    overdueCount: $('#overdue-count'),
    modalOverlay: $('#modal-overlay'),
    modalDefeatOverlay: $('#modal-defeat-overlay'),
    modalDamageOverlay: $('#modal-damage-overlay'),
    defeatSlash: $('#defeat-slash'),
    defeatIcon: $('#defeat-icon'),
    defeatText: $('#defeat-text'),
    defeatXp: $('#defeat-xp'),
    damageText: $('#damage-text'),
    damageAmount: $('#damage-amount'),
    form: $('#form-summon'),
    enemyName: $('#enemy-name'),
    enemyModule: $('#enemy-module'),
    enemyDeadline: $('#enemy-deadline'),
    enemyNotes: $('#enemy-notes'),
    typeSelector: $('#type-selector'),
    dmHint: $('#dm-hint'),
    toastContainer: $('#toast-container'),
  };

  /* ── UTILITIES ───────────────────────────────────────── */
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function daysUntil(dateStr) {
    const d = new Date(dateStr + 'T23:59:59');
    const now = new Date();
    return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  }

  function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T23:59:59');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  function xpForLevel(lvl) {
    return Math.floor(XP_PER_LEVEL * Math.pow(1.35, lvl - 1));
  }

  function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    dom.toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  /* ── PERSISTENCE ─────────────────────────────────────── */
  function saveState() {
    localStorage.setItem('questlog_dam_v2', JSON.stringify({
      enemies: state.enemies, bestiary: state.bestiary,
      xp: state.xp, level: state.level, hp: state.hp,
    }));
  }

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem('questlog_dam_v2'));
      if (s) {
        state.enemies = s.enemies || [];
        state.bestiary = s.bestiary || [];
        state.xp = s.xp || 0;
        state.level = s.level || 1;
        state.hp = s.hp ?? HP_BASE;
      }
    } catch { /* datos corruptos: ignorar */ }
  }

  /* ── API ─────────────────────────────────────────────── */
  async function apiGet(p) { try { const r = await fetch(API_BASE + p); return r.ok ? r.json() : null; } catch { return null; } }
  async function apiPost(p, b) { try { const r = await fetch(API_BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.ok ? r.json() : null; } catch { return null; } }
  async function apiDelete(p) { try { const r = await fetch(API_BASE + p, { method: 'DELETE' }); return r.ok; } catch { return false; } }

  /* ── HP SYSTEM ───────────────────────────────────────── */
  function applyOverdueDamage(enemy) {
    const info = ENEMY_TYPES[enemy.type];
    const damage = info.damage * Math.min(Math.abs(daysUntil(enemy.deadline)), 7);
    state.hp = Math.max(0, state.hp - damage);
    return damage;
  }

  /* Solo penaliza la primera vez que se detecta el vencimiento */
  function recalcHp() {
    let totalDamage = 0;

    state.enemies.forEach(e => {
      if (!e.hpPenalty && daysUntil(e.deadline) < 0) {
        const dmg = applyOverdueDamage(e);
        totalDamage += dmg;
        e.hpPenalty = true;
      }
    });

    if (totalDamage > 0) {
      showDamageModal(totalDamage);
      showToast(`💔 Pierdes ${totalDamage} HP por misiones vencidas`, 'error');
    }
    return totalDamage;
  }

  /* ── RENDER: HERO BAR ───────────────────────────────── */
  function renderHeroBar() {
    const needed = xpForLevel(state.level);
    const xpPct = Math.min((state.xp / needed) * 100, 100);
    const hpPct = Math.min((state.hp / HP_BASE) * 100, 100);

    dom.hpBarFill.style.width = hpPct + '%';
    dom.hpBarFill.classList.toggle('low', hpPct <= 50);
    dom.hpBarFill.classList.toggle('critical', hpPct <= 25);
    dom.hpCurrent.textContent = state.hp;
    dom.hpMax.textContent = HP_BASE;

    dom.xpBarFill.style.width = xpPct + '%';
    dom.xpCurrent.textContent = state.xp;
    dom.xpNeeded.textContent = needed;
    dom.heroLevel.textContent = `Nivel ${state.level}`;
    dom.statKills.textContent = state.bestiary.length;
  }

  /* ── RENDER: ENEMY CARD ─────────────────────────────── */
  function createEnemyCard(enemy, bestiary = false) {
    const info = ENEMY_TYPES[enemy.type] || ENEMY_TYPES.slime;
    const subj = SUBJECT_MAP[enemy.module] || { dm: '?', emoji: '📚' };
    const diff = daysUntil(enemy.deadline);
    const isOverdue = diff < 0;
    const isUrgent = diff >= 0 && diff <= URGENT_DAYS;

    const card = document.createElement('div');
    card.className = `enemy-card type-${enemy.type} ${isOverdue ? 'overdue' : ''}`;
    card.dataset.id = enemy.id;

    /* Texto del deadline */
    let deadlineText;
    if (bestiary) {
      deadlineText = `📅 ${fmtDate(enemy.deadline)}`;
    } else if (isOverdue) {
      deadlineText = `☠️ VENCIDO hace ${Math.abs(diff)}d (${fmtDate(enemy.deadline)})`;
    } else if (isUrgent) {
      deadlineText = `🔥 ${diff === 0 ? '¡HOY!' : diff + 'd restantes'} — ${fmtDate(enemy.deadline)}`;
    } else {
      deadlineText = `📅 ${diff}d — ${fmtDate(enemy.deadline)}`;
    }

    card.innerHTML = `
      <div class="enemy-emoji">${info.emoji}</div>
      <div class="enemy-details">
        <div class="enemy-name">${escapeHtml(enemy.name)}</div>
        <div class="enemy-meta">
          <span class="enemy-type-badge ${enemy.type}">${info.label}</span>
          <span class="enemy-module">${subj.emoji} ${escapeHtml(enemy.module)}</span>
          <span class="enemy-dm">DM: ${escapeHtml(subj.dm)}</span>
          <span class="enemy-deadline ${isOverdue ? 'deadline-overdue' : isUrgent ? 'deadline-urgent' : ''}">${deadlineText}</span>
        </div>
        ${enemy.notes ? `<div class="enemy-notes">${escapeHtml(enemy.notes)}</div>` : ''}
      </div>
      <div class="enemy-actions">
        <button class="btn-defeat" title="¡Derrotar!">⚔️ ${bestiary ? 'Derrotado' : 'Atacar'}</button>
      </div>
    `;

    const btn = card.querySelector('.btn-defeat');
    if (bestiary) {
      btn.disabled = true;
      btn.style.opacity = '.4';
      btn.style.cursor = 'default';
    } else {
      btn.addEventListener('click', () => defeatEnemy(enemy));
    }
    return card;
  }

  /* ── RENDER: LISTS ──────────────────────────────────── */
  function renderEnemyList() {
    let list = [...state.enemies];
    if (state.activeFilter !== 'all') {
      list = list.filter(e => e.type === state.activeFilter);
    }
    /* Ordenar: vencidos y urgentes primero, luego por fecha. Los sin fecha al final */
    list.sort((a, b) => {
      const da = daysUntil(a.deadline);
      const db = daysUntil(b.deadline);
      if (da < 0 && db >= 0) return -1;
      if (db < 0 && da >= 0) return 1;
      return da - db;
    });

    dom.enemyList.innerHTML = '';
    if (list.length === 0) {
      dom.enemyList.appendChild(emptyState(
        '🏰',
        state.activeFilter === 'all'
          ? 'No hay enemigos activos. ¡Invocad vuestra primera misión!'
          : 'No hay enemigos de este tipo en combate.'
      ));
      return;
    }
    list.forEach(e => dom.enemyList.appendChild(createEnemyCard(e)));
  }

  function renderBestiary() {
    dom.bestiaryList.innerHTML = '';
    if (state.bestiary.length === 0) {
      dom.bestiaryList.appendChild(emptyState('📖', 'Aún no derrotais ningún enemigo. ¡A la batalla!'));
      return;
    }
    [...state.bestiary].reverse().forEach(e => dom.bestiaryList.appendChild(createEnemyCard(e, true)));
  }

  function emptyState(icon, text) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.innerHTML = `<div class="empty-icon">${icon}</div><p>${text}</p>`;
    return el;
  }

  /* ── RENDER: STATS ──────────────────────────────────── */
  function renderStats() {
    const kills = state.bestiary.length;
    const slimes = state.bestiary.filter(e => e.type === 'slime').length;
    const minis = state.bestiary.filter(e => e.type === 'miniboss').length;
    const bosses = state.bestiary.filter(e => e.type === 'boss').length;
    const urgent = state.enemies.filter(e => { const d = daysUntil(e.deadline); return d <= URGENT_DAYS && d >= 0; }).length;
    const overdue = state.enemies.filter(e => daysUntil(e.deadline) < 0).length;

    dom.totalDefeated.textContent = kills;
    dom.totalSlimes.textContent = slimes;
    dom.totalMiniboss.textContent = minis;
    dom.totalBoss.textContent = bosses;
    dom.totalXp.textContent = state.xp;
    dom.totalHp.textContent = state.hp;
    dom.urgentCount.textContent = urgent;
    dom.overdueCount.textContent = overdue;
  }

  function renderAll() {
    renderHeroBar();
    renderEnemyList();
    renderBestiary();
    renderStats();
  }

  /* ── ACTIONS ────────────────────────────────────────── */
  function addEnemy(data) {
    const enemy = {
      id: genId(),
      name: data.name,
      type: data.type,
      module: data.module,
      deadline: data.deadline,
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
    };
    state.enemies.push(enemy);
    saveState();
    renderAll();
    showToast(`📜 «${enemy.name}» ha sido invocado al campo de batalla`);
    apiPost('/missions', enemy);
  }

  function defeatEnemy(enemy) {
    const xpGain = ENEMY_TYPES[enemy.type].xp;
    state.xp += xpGain;

    /* Level up */
    let needed = xpForLevel(state.level);
    while (state.xp >= needed) {
      state.xp -= needed;
      state.level++;
      showToast(`🎉 ¡Subes al Nivel ${state.level}!`);
      needed = xpForLevel(state.level);
    }

    /* Remove from active, add to bestiary */
    state.enemies = state.enemies.filter(e => e.id !== enemy.id);
    enemy.defeatedAt = new Date().toISOString();
    state.bestiary.push(enemy);
    saveState();

    /* Sword slash animation */
    const card = dom.enemyList.querySelector(`[data-id="${enemy.id}"]`);
    if (card) {
      card.classList.add('defeating');
      setTimeout(() => renderAll(), 500);
    } else {
      renderAll();
    }

    showDefeatModal(enemy, xpGain);
    apiDelete('/missions/' + enemy.id);
  }

  /* ── MODALS ─────────────────────────────────────────── */
  function showDefeatModal(enemy, xp) {
    dom.defeatIcon.textContent = ENEMY_TYPES[enemy.type].emoji;
    dom.defeatText.textContent = `¡${enemy.name} derrotado!`;
    dom.defeatXp.textContent = `+${xp} XP`;
    dom.defeatSlash.classList.remove('active');
    void dom.defeatSlash.offsetWidth;  /* restart animation */
    dom.defeatSlash.classList.add('active');
    dom.modalDefeatOverlay.classList.add('open');
    setTimeout(() => dom.modalDefeatOverlay.classList.remove('open'), 1600);
  }

  function showDamageModal(total) {
    dom.damageText.textContent = `¡Misiones vencidas!`;
    dom.damageAmount.textContent = `-${total} HP`;
    dom.modalDamageOverlay.classList.add('open');
    setTimeout(() => dom.modalDamageOverlay.classList.remove('open'), 1800);
  }

  /* ── MODULE SELECT FILL ─────────────────────────────── */
  function fillModuleSelect() {
    const sel = dom.enemyModule;
    sel.innerHTML = '<option value="">Selecciona asignatura...</option>';
    SUBJECTS.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.module;
      opt.textContent = `${s.emoji} ${s.module} — ${s.dm}`;
      sel.appendChild(opt);
    });
  }

  /* ── EVENTS ─────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      dom.modalOverlay.classList.remove('open');
      dom.modalDefeatOverlay.classList.remove('open');
      dom.modalDamageOverlay.classList.remove('open');
    }
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !isInputFocused() && !dom.modalOverlay.classList.contains('open')) {
      e.preventDefault();
      dom.modalOverlay.classList.add('open');
      dom.enemyName.focus();
    }
  });

  function isInputFocused() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  /* Tabs */
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $('#' + btn.dataset.tab).classList.add('active');
    });
  });

  /* Filters */
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.dataset.filter;
      renderEnemyList();
    });
  });

  /* Modal open/close */
  $('#btn-summon').addEventListener('click', () => {
    dom.modalOverlay.classList.add('open');
    dom.enemyName.focus();
  });

  $('#modal-close').addEventListener('click', () => dom.modalOverlay.classList.remove('open'));

  dom.modalOverlay.addEventListener('click', e => {
    if (e.target === dom.modalOverlay) dom.modalOverlay.classList.remove('open');
  });
  dom.modalDefeatOverlay.addEventListener('click', () => dom.modalDefeatOverlay.classList.remove('open'));
  dom.modalDamageOverlay.addEventListener('click', () => dom.modalDamageOverlay.classList.remove('open'));

  /* Type selector */
  dom.typeSelector.addEventListener('click', e => {
    const btn = e.target.closest('.type-btn');
    if (!btn) return;
    dom.typeSelector.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.selectedType = btn.dataset.type;
  });

  /* DM hint on subject change */
  dom.enemyModule.addEventListener('change', () => {
    const s = SUBJECT_MAP[dom.enemyModule.value];
    if (s) {
      dom.dmHint.textContent = `🧙 Dungeon Master: ${s.dm}`;
    } else {
      dom.dmHint.textContent = '';
    }
  });

  /* Form submit */
  dom.form.addEventListener('submit', e => {
    e.preventDefault();
    const name = dom.enemyName.value.trim();
    const module = dom.enemyModule.value;
    const deadline = dom.enemyDeadline.value;
    const notes = dom.enemyNotes.value.trim();

    if (!name || !module || !deadline) {
      showToast('⚠️ Rellena nombre, asignatura y fecha', 'warning');
      return;
    }

    addEnemy({ name, type: state.selectedType, module, deadline, notes });

    dom.form.reset();
    dom.typeSelector.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
    dom.typeSelector.querySelector('[data-type="slime"]').classList.add('selected');
    state.selectedType = 'slime';
    dom.dmHint.textContent = '';
    dom.enemyName.focus();
    dom.modalOverlay.classList.remove('open');
  });

  /* Clear bestiary */
  $('#btn-clear-history').addEventListener('click', () => {
    if (state.bestiary.length === 0) {
      showToast('📜 El bestiario ya está vacío', 'warning');
      return;
    }
    if (confirm('¿Eliminar el registro del bestiario?')) {
      state.bestiary = [];
      saveState();
      renderAll();
      showToast('🗑️ Bestiario limpiado');
    }
  });

  /* ── SYNC FROM API ──────────────────────────────────── */
  async function syncFromAPI() {
    const data = await apiGet('/missions');
    if (data && Array.isArray(data)) {
      const localIds = new Set(state.enemies.map(e => e.id));
      let added = 0;
      data.forEach(apiE => {
        if (!localIds.has(apiE.id)) {
          state.enemies.push(apiE);
          added++;
        }
      });
      if (added > 0) {
        saveState();
        renderAll();
      }
    }
  }

  /* ── INIT ───────────────────────────────────────────── */
  fillModuleSelect();
  loadState();
  recalcHp();
  saveState();
  renderAll();
  syncFromAPI();

  /* Si una misión vence mientras la app está abierta, HP cae automático */
  setInterval(() => {
    if (recalcHp() > 0) {
      saveState();
      renderAll();
    }
  }, 60 * 1000);

})();