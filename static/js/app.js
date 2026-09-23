// ═══════════════════════════════════════════════════════════════════════════
//  app.js — Interface DRE (pesquisa, ontologia, inserção RDF, estatísticas)
// ═══════════════════════════════════════════════════════════════════════════

let currentPage = 1;
let currentDocId = null;
let currentEntityId = null;
let currentClass = '';      // filtro ativo vindo da sidebar de classes OWL
let toastTimer = null;

// ─── Utilitários ─────────────────────────────────────────────────────────────

// Escapa texto para inserir em innerHTML / atributos (evita XSS)
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// URL segura para href (bloqueia javascript:, data:, vbscript:)
function safeUrl(u) {
  const s = String(u || '').trim();
  return /^(javascript|data|vbscript):/i.test(s) ? '' : esc(s);
}

function uniqueBy(list, key) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter(i => {
    if (seen.has(i[key])) return false;
    seen.add(i[key]);
    return true;
  });
}

const jsonOpts = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// fetch + verificação de erro HTTP + parse JSON. Lança Error com mensagem útil.
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch { /* resposta sem JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

// Executa uma ação (POST/DELETE...) que devolve {ok, error} e mostra toasts.
async function apiAction(url, options, successMsg, onSuccess) {
  try {
    const d = await apiFetch(url, options);
    if (d && d.ok) {
      if (successMsg) showToast(successMsg);
      if (onSuccess) await onSuccess(d);
      return d;
    }
    showToast('Erro: ' + ((d && d.error) || ''), true);
  } catch (err) {
    console.error(err);
    showToast('Erro: ' + err.message, true);
  }
  return null;
}

function showToast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ─── Navegação ───────────────────────────────────────────────────────────────

function showView(id, btn) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'estatisticas') loadStats();
  if (id === 'ontologia') renderOntologyTree();
  // A vista "adicionar" carrega os seus dados em openAddView(), consoante o painel.
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ─── Pesquisa ────────────────────────────────────────────────────────────────

async function search(page = 1) {
  currentPage = page;
  const q = document.getElementById('q').value;
  const categoria = document.getElementById('f-categoria').value;
  const serie = document.getElementById('f-serie').value;
  const vigor = document.getElementById('f-vigor').value;
  const anoIni = document.getElementById('f-ano-ini').value;
  const anoFim = document.getElementById('f-ano-fim').value;
  const entidade = document.getElementById('f-entidade').value;

  const params = new URLSearchParams({
    q, categoria, serie, vigor,
    ano_ini: anoIni, ano_fim: anoFim, entidade, page, per_page: 25
  });
  if (currentClass) params.set('owl_class', currentClass);

  const info = document.getElementById('result-info');
  info.innerHTML = 'A pesquisar... <span class="loader"></span>';

  try {
    const data = await apiFetch('/api/search?' + params);
    renderResults(data);
  } catch (err) {
    console.error('Erro na pesquisa:', err);
    info.textContent = 'Erro ao pesquisar: ' + err.message;
    showToast('Erro ao pesquisar: ' + err.message, true);
  }
}

function resetFilterInputs() {
  ['f-categoria', 'f-serie', 'f-vigor', 'f-ano-ini', 'f-ano-fim', 'f-entidade', 'q']
    .forEach(id => { document.getElementById(id).value = ''; });
}

function clearFilters() {
  resetFilterInputs();
  currentClass = '';
  document.querySelectorAll('.onto-class').forEach(e => e.classList.remove('selected'));
  search(1);
}

function filterByClass(cls, el) {
  document.querySelectorAll('.onto-class').forEach(e => e.classList.remove('selected'));
  if (el) el.classList.add('selected');
  resetFilterInputs();
  currentClass = cls;
  showView('pesquisa', document.querySelector('nav button'));
  search(1);
}

function renderResults(data) {
  const tbody = document.getElementById('results-tbody');
  const info = document.getElementById('result-info');
  const pag = document.getElementById('pagination');

  if (!data || !data.results || !data.results.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--cinza3);padding:2rem">
      Nenhum resultado encontrado.</td></tr>`;
    info.innerHTML = '<span>0 resultados</span>';
    pag.innerHTML = '';
    return;
  }

  info.innerHTML = `<strong>${Number(data.total).toLocaleString('pt-PT')}</strong> resultados
    — página <strong>${Number(data.page)}</strong> de <strong>${Number(data.pages)}</strong>`;

  tbody.innerHTML = data.results.map(r => {
    const badgeClass = r.is_entity ? 'badge-gold'
                     : r.categoria === 'Ato Normativo' ? 'badge-norm'
                     : r.categoria === 'Ato Administrativo' ? 'badge-adm'
                     : r.categoria === 'Ato Informativo' ? 'badge-info' : 'badge-outro';

    const vigencia = r.is_entity ? '—'
      : (r.in_force ? '<span class="vigente">● Em vigor</span>' : '<span class="revogado">○ Revogado</span>');
    const url = safeUrl(r.url_pdf);
    const pdf = url ? `<a href="${url}" target="_blank" rel="noopener" class="link-doc" title="Abrir PDF">📄</a>` : '—';
    const sum = r.sumario || '';
    const shortSumario = sum.length > 120 ? sum.slice(0, 120) + '…' : (sum || '—');
    const id = Number(r.id);

    const actionsHtml = r.is_entity
      ? `<button class="btn btn-gold" onclick="openEntity(event, ${id})">🏛️ Entidade</button>`
      : `<button class="btn btn-secondary" onclick="openDocFromTable(event, ${id})">Abrir</button>
         <button class="btn btn-danger" onclick="removeDoc(event, ${id})">Remover</button>`;

    return `<tr>
      <td><span style="font-family:var(--mono);font-size:.75rem">${esc(r.claint || '—')}</span></td>
      <td><span class="badge ${badgeClass}" ${r.is_entity ? 'style="background:var(--ouro);color:#fff;"' : ''}>${r.is_entity ? '🏛️ Entidade' : esc((r.doc_type || '').slice(0, 22))}</span></td>
      <td style="font-family:var(--mono);font-size:.75rem">${esc(r.numero || '—')}</td>
      <td style="font-family:var(--mono);font-size:.75rem;white-space:nowrap">${esc(r.data || '—')}</td>
      <td style="text-align:center;font-family:var(--mono)">${r.serie && r.serie !== '—' ? 'S' + esc(r.serie) : '—'}</td>
      <td style="max-width:320px;font-size:.78rem; ${r.is_entity ? 'font-weight:600; color:var(--verde2);' : ''}">${esc(shortSumario)}</td>
      <td>${vigencia}</td>
      <td>${pdf}</td>
      <td style="white-space:nowrap;">${actionsHtml}</td>
    </tr>`;
  }).join('');

  // Paginação
  const pages = Number(data.pages);
  const cur = Number(data.page);
  let pagHtml = '';
  if (cur > 1) pagHtml += `<button class="page-btn" onclick="search(${cur - 1})">‹ Anterior</button>`;
  const start = Math.max(1, cur - 3), end = Math.min(pages, cur + 3);
  if (start > 1) pagHtml += `<button class="page-btn" onclick="search(1)">1</button><span>…</span>`;
  for (let p = start; p <= end; p++) {
    pagHtml += `<button class="page-btn ${p === cur ? 'current' : ''}" onclick="search(${p})">${p}</button>`;
  }
  if (end < pages) pagHtml += `<span>…</span><button class="page-btn" onclick="search(${pages})">${pages}</button>`;
  if (cur < pages) pagHtml += `<button class="page-btn" onclick="search(${cur + 1})">Seguinte ›</button>`;
  pag.innerHTML = pagHtml;
}

// ─── Documentos ──────────────────────────────────────────────────────────────

function openDocFromTable(ev, id) {
  ev.stopPropagation();
  openDoc(id);
}

async function removeDoc(ev, id) {
  ev.stopPropagation();
  if (!confirm('Eliminar documento e todas as suas ligações?')) return;
  await apiAction('/api/documento/' + id, { method: 'DELETE' }, 'Documento removido',
    () => search(currentPage));
}

async function openDoc(id) {
  currentDocId = id;
  let d;
  try {
    d = await apiFetch('/api/documento/' + id);
  } catch (err) {
    console.error(err);
    showToast('Erro ao abrir documento: ' + err.message, true);
    return;
  }

  document.getElementById('modal-title').textContent =
    (d.doc_type || 'Documento') + (d.numero ? ' n.º ' + d.numero : '');

  const badgeClass = d.categoria === 'Ato Normativo' ? 'badge-norm'
                   : d.categoria === 'Ato Administrativo' ? 'badge-adm'
                   : 'badge-info';

  const rels = (d.relacoes || []).map(r => {
    const badge = r.tipo_exibicao || r.tipo_relacao;
    let relationText;
    if (badge === 'revoga') {
      relationText = `${esc(r.claint_destino || '—')} — ${esc(r.numero_destino || '—')}`;
    } else if (badge === 'revogadoPor') {
      relationText = `${esc(r.claint_origem || '—')} — ${esc(r.numero_origem || '—')}`;
    } else {
      const origemTxt = `Origem: ${esc(r.claint_origem || '—')} — ${esc(r.numero_origem || '—')}`;
      const destinoTxt = `Destino: ${esc(r.claint_destino || '—')} — ${esc(r.numero_destino || '—')}`;
      relationText = `${origemTxt} → ${destinoTxt}`;
    }
    return `<div class="rel-item">
      <span class="rel-tipo">${esc(badge)}</span>
      <div style="margin-left:0.5rem;font-size:.9rem;color:var(--cinza3)">${relationText}</div>
      <button class="btn btn-danger" style="margin-left:auto" onclick="removeRelacao(event, ${Number(r.rel_id)})">Remover</button>
    </div>`;
  }).join('') || '<span style="color:var(--cinza3);font-size:.8rem">Sem relações registadas</span>';

  const urlPdf = safeUrl(d.url_pdf);
  const urlTexto = safeUrl(d.url_texto);

  document.getElementById('modal-body').innerHTML = `
    <div class="meta-grid">
      <dl class="meta-item"><dt>Claint</dt><dd style="font-family:var(--mono)">${esc(d.claint || '—')}</dd></dl>
      <dl class="meta-item"><dt>Classe OWL</dt><dd><span class="badge ${badgeClass}">${esc(d.owl_class || '—')}</span></dd></dl>
      <dl class="meta-item"><dt>Número</dt><dd>${esc(d.numero || '—')}</dd></dl>
      <dl class="meta-item"><dt>DR / Número</dt><dd style="font-family:var(--mono)">${esc(d.dr_number || '—')}</dd></dl>
      <dl class="meta-item"><dt>Série</dt><dd>Série ${esc(d.serie || '—')}</dd></dl>
      <dl class="meta-item"><dt>Data</dt><dd>${esc(d.data || '—')}</dd></dl>
      <dl class="meta-item"><dt>Vigência</dt><dd>${d.in_force ? '✅ Em vigor' : '❌ Revogado'}</dd></dl>
      <dl class="meta-item"><dt>Entidade(s)</dt><dd style="font-size:.8rem">${(d.entidades || []).map(esc).join('<br>') || '—'}</dd></dl>
    </div>
    ${d.sumario ? `<div class="sumario-box">${esc(d.sumario)}</div>` : ''}
    <div style="display:flex;gap:.5rem;margin:.75rem 0;flex-wrap:wrap">
      ${urlPdf ? `<a href="${urlPdf}" target="_blank" rel="noopener" class="btn btn-primary" style="font-size:.8rem;text-decoration:none">📄 Ver PDF</a>` : ''}
      ${urlTexto ? `<a href="${urlTexto}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.8rem;text-decoration:none">📝 Texto integral</a>` : ''}
    </div>
    <div class="rel-section">
      <h4>🔗 Relações com outros documentos</h4>
      ${rels}
      <div class="rel-form">
        <select id="rel-tipo">
          <option value="revoga">revoga</option>
          <option value="revogadoPor">revogado por</option>
          <option value="alteradoPor">alterado por</option>
          <option value="rectificadoPor">retificado por</option>
          <option value="suspensoPor">suspenso por</option>
          <option value="desenvolve">desenvolve</option>
        </select>
        <input type="number" id="rel-claint" placeholder="claint destino" style="width:130px">
        <button class="btn btn-primary" onclick="addRelacao()">Adicionar</button>
      </div>
    </div>
    <div style="font-family:var(--mono);font-size:.68rem;color:var(--cinza3);margin-top:1rem">
      Fonte: ${esc(d.fonte || '—')}<br>Criado: ${esc(d.timestamp || '—')}
    </div>
  `;
  document.getElementById('modal-overlay').classList.add('open');
}

async function addRelacao() {
  const tipo = document.getElementById('rel-tipo').value;
  const claint = document.getElementById('rel-claint').value;
  if (!claint) { showToast('Introduza o claint do documento destino', true); return; }
  await apiAction('/api/relacao',
    jsonOpts('POST', { doc_id: currentDocId, tipo_relacao: tipo, claint_destino: parseInt(claint, 10) }),
    'Relação adicionada!', () => openDoc(currentDocId));
}

async function removeRelacao(ev, relId) {
  ev.stopPropagation();
  if (!confirm('Eliminar esta relação?')) return;
  await apiAction('/api/relacao/' + relId, { method: 'DELETE' },
    'Relação removida', () => openDoc(currentDocId));
}

// ─── Entidades ───────────────────────────────────────────────────────────────

async function openEntity(ev, id) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  currentEntityId = id;

  let d;
  try {
    d = await apiFetch('/api/entidade/' + id + '/docs');
  } catch (err) {
    console.error(err);
    showToast('Erro ao abrir entidade: ' + err.message, true);
    return;
  }

  const title = d.entity || 'Entidade';
  const docs = d.docs || [];
  const entityTipo = d.entity_tipo;

  document.getElementById('modal-title').textContent =
    `Entidade: ${title}` + (entityTipo ? ` — ${entityTipo}` : '');

  if (!docs.length) {
    document.getElementById('modal-body').innerHTML =
      '<div style="color:var(--cinza3);padding:1rem 0">Sem documentos associados.</div>';
  } else {
    document.getElementById('modal-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:.5rem">
        ${docs.map(doc => {
          const docId = Number(doc.id);
          const linked = doc.matched_by === 'linked';
          return `
          <div style="display:flex;align-items:center;gap:.5rem;border-bottom:1px solid var(--cinza1);padding:.5rem 0">
            <div style="flex:1">
              <div style="font-weight:600">${esc(doc.doc_type || doc.owl_class || 'Documento')} ${doc.numero ? '— ' + esc(doc.numero) : ''}</div>
              <div style="font-size:.85rem;color:var(--cinza3)">${esc((doc.sumario || '').slice(0, 140))}</div>
              <div style="display:flex;gap:.5rem;margin-top:.25rem;align-items:center">
                <div style="font-size:.75rem;color:var(--cinza4)">${linked ? 'Ligado explicitamente à entidade' : 'Correspondência por texto no campo entidades'}</div>
                ${doc.class_match ? `<div style="background:#efe; color:#060; padding:.12rem .4rem;border-radius:.25rem;font-size:.72rem">Classe igual à entidade</div>` : ''}
              </div>
            </div>
            <div style="margin-left:auto;display:flex;gap:.4rem;flex-direction:column;align-items:flex-end">
              <button class="btn btn-secondary" onclick="openDocFromTable(event, ${docId})">Abrir</button>
              ${linked
                ? `<button class="btn btn-danger" style="margin-top:.35rem" onclick="unlinkDoc(event, ${docId})">Desassociar</button>`
                : `<button class="btn btn-gold" style="margin-top:.35rem" onclick="linkDoc(event, ${docId})">Associar</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }
  document.getElementById('modal-overlay').classList.add('open');
}

async function linkDoc(ev, docId) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (!currentEntityId) { showToast('Entidade não definida', true); return; }
  await apiAction(`/api/entidade/${currentEntityId}/link/${docId}`, { method: 'POST' },
    'Documento associado', () => openEntity(null, currentEntityId));
}

async function unlinkDoc(ev, docId) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (!currentEntityId) { showToast('Entidade não definida', true); return; }
  await apiAction(`/api/entidade/${currentEntityId}/link/${docId}`, { method: 'DELETE' },
    'Ligação removida', () => openEntity(null, currentEntityId));
}

// ─── Estatísticas ────────────────────────────────────────────────────────────

async function loadStats() {
  let d;
  try {
    d = await apiFetch('/api/stats');
  } catch (err) {
    console.error('Erro ao carregar estatísticas:', err);
    showToast('Erro ao carregar estatísticas: ' + err.message, true);
    return;
  }

  const fmt = n => Number(n || 0).toLocaleString('pt-PT');

  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card">
      <div class="big-num">${fmt(d.total)}</div>
      <div class="label">Total de Documentos</div>
    </div>
    <div class="stat-card">
      <div class="big-num">${fmt(d.em_vigor)}</div>
      <div class="label">Em Vigor</div>
    </div>
    <div class="stat-card red">
      <div class="big-num">${fmt(d.total - d.em_vigor)}</div>
      <div class="label">Revogados</div>
    </div>
    <div class="stat-card gold">
      <div class="big-num">${fmt(d.n_entidades)}</div>
      <div class="label">Entidades Emissoras</div>
    </div>
    <div class="stat-card">
      <div class="big-num">${Number(d.anos_cobertura) || 0}</div>
      <div class="label">Anos de Cobertura</div>
    </div>
    <div class="stat-card gold">
      <div class="big-num">${fmt(d.com_pdf)}</div>
      <div class="label">Com PDF Disponível</div>
    </div>
  `;

  renderBarChart('chart-tipos', d.top_tipos, 15);
  renderBarChart('chart-entidades', d.top_entidades, 15);
  renderBarChart('chart-series',
    (d.por_serie || []).map(r => ({ label: 'Série ' + r[0], count: r[1] })), 3);
  renderBarChart('chart-anos', d.por_decada, 12);
}

function renderBarChart(elemId, items, max) {
  const el = document.getElementById(elemId);
  if (!el || !items || !items.length) return;
  const maxVal = Math.max(...items.map(i => i.count || i[1] || 0));
  el.innerHTML = items.slice(0, max).map(item => {
    const label = item.label || item[0] || '';
    const count = Number(item.count || item[1] || 0);
    const pct = maxVal ? count / maxVal * 100 : 0;
    return `<div class="bar-item">
      <div class="bar-label" title="${esc(label)}">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-num">${count.toLocaleString('pt-PT')}</div>
    </div>`;
  }).join('');
}

async function loadQuickStats() {
  const el = document.getElementById('quick-stats');
  try {
    const d = await apiFetch('/api/quickstats');
    const fmt = n => Number(n || 0).toLocaleString('pt-PT');
    const badge = (label, val) => `
      <div class="stat-badge">
        <span>${label}</span>
        <span class="num">${fmt(val)}</span>
      </div>`;
    el.innerHTML =
      badge('Documentos', d.total) + badge('Em vigor', d.em_vigor) +
      badge('Série I', d.serie_1) + badge('Série II', d.serie_2) +
      badge('Com PDF', d.com_pdf) + badge('Entidades', d.entidades);
  } catch (err) {
    console.error('Erro ao carregar resumo:', err);
    el.innerHTML = '<div style="font-size:.75rem;color:var(--vermelho)">Erro ao carregar resumo.</div>';
  }
}

// ─── Classes OWL personalizadas (guardadas em localStorage) ─────────────────

const CUSTOM_CLASSES_KEY = 'dre_custom_owl_classes';

function getCustomClasses() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CLASSES_KEY) || '[]'); }
  catch { return []; }
}

function setCustomClasses(list) {
  try { localStorage.setItem(CUSTOM_CLASSES_KEY, JSON.stringify(list)); }
  catch (err) { console.warn('Não foi possível guardar em localStorage:', err); }
}

function saveCustomClass(localname, parent, label, uri = null) {
  const classes = getCustomClasses();
  const fullClass = 'dre:' + localname;
  const fullParent = parent ? 'dre:' + parent : 'dre:EntidadeEmissora';
  if (!classes.find(c => c.cls === fullClass)) {
    classes.push({ cls: fullClass, parent: fullParent, label: label || localname, uri: uri || null });
    setCustomClasses(classes);
  }
}

async function refreshOntologyUI() {
  await Promise.all([
    renderOntologyTree(),
    loadOwlClasses(),
    loadRdfParentClasses(),
    loadQuickStats()
  ]);
}

async function removeCustomClass(cls) {
  if (!confirm('⚠️ Remover a classe ' + cls +
      ' da ontologia permanentemente? Esta ação não pode ser desfeita.')) return;

  const customClass = getCustomClasses().find(c => c.cls === cls);

  // Enviar preferencialmente o URI real da classe. Isto evita confusão entre
  // http://dre.pt/ontology# e http://dre.pt/ontologia#
  const payload = { class_name: cls };
  if (customClass && customClass.uri) payload.class_uri = customClass.uri;

  try {
    const data = await apiFetch('/api/rdf/classe', jsonOpts('DELETE', payload));
    if (data && data.ok) {
      setCustomClasses(getCustomClasses().filter(c => c.cls !== cls));
      await refreshOntologyUI();
      showToast('✓ Classe ' + cls + ' removida da ontologia');
    } else {
      showToast('Erro ao remover classe: ' + ((data && data.error) || 'Erro desconhecido'), true);
    }
  } catch (err) {
    console.error('Erro ao remover classe:', err);
    showToast('Erro ao remover classe: ' + err.message, true);
  }
}

// ─── Árvore de ontologia ─────────────────────────────────────────────────────

// Hierarquia base (fallback). É combinada com os "parents" devolvidos pelo
// servidor e com as classes personalizadas.
const BASE_HIERARCHY = {
  'dre:DocumentoOficial': ['dre:AtoNormativo', 'dre:AtoAdministrativo', 'dre:AtoInformativo'],
  'dre:AtoNormativo': ['dre:Lei', 'dre:DecretoLei', 'dre:Decreto', 'dre:Portaria',
                       'dre:Regulamento', 'dre:Resolucao', 'dre:Rectificacao'],
  'dre:Lei': ['dre:LeiOrganica'],
  'dre:Decreto': ['dre:DecretoRegulamentar'],
  'dre:AtoAdministrativo': ['dre:Despacho', 'dre:Deliberacao', 'dre:Contrato',
                            'dre:Louvor', 'dre:Declaracao'],
  'dre:Despacho': ['dre:DespachoExtrato'],
  'dre:AtoInformativo': ['dre:Aviso', 'dre:AvisoContumax', 'dre:AnuncioProcedimento',
                         'dre:Anuncio', 'dre:Edital'],
  'dre:Aviso': ['dre:AvisoExtrato']
};

async function renderOntologyTree() {
  const container = document.getElementById('ontology-tree');
  try {
    const allClasses = uniqueBy(await apiFetch('/api/owl-classes-all'), 'cls');
    const customClasses = getCustomClasses();
    const customIds = new Set(customClasses.map(c => c.cls));

    // 1. Construir hierarquia: base + servidor + personalizadas
    const hierarchy = {};
    const addChild = (parent, child) => {
      if (!hierarchy[parent]) hierarchy[parent] = [];
      if (!hierarchy[parent].includes(child)) hierarchy[parent].push(child);
    };
    Object.entries(BASE_HIERARCHY).forEach(([p, kids]) => kids.forEach(k => addChild(p, k)));
    allClasses.forEach(c => {
      (Array.isArray(c.parents) ? c.parents : []).forEach(p => {
        if (p !== c.cls) addChild(p, c.cls);
      });
    });
    customClasses.forEach(c => addChild(c.parent || 'dre:DocumentoOficial', c.cls));

    // 2. Labels
    const classMap = new Map(allClasses.map(c => [c.cls, c.label]));
    customClasses.forEach(c => {
      if (!classMap.has(c.cls)) classMap.set(c.cls, c.label || c.cls.replace('dre:', ''));
    });

    // 3. Renderização recursiva (com proteção contra ciclos)
    function renderChildren(parentClass, level, path) {
      const children = (hierarchy[parentClass] || []).filter(ch => !path.has(ch));
      return children.map((child, idx) => {
        const icon = idx === children.length - 1 ? '└─' : '├─';
        const label = classMap.get(child) || child.replace('dre:', '');
        const isCustom = customIds.has(child);

        let row = `<div style="padding-left:${level * 2}em;display:flex;justify-content:space-between;align-items:center;${level > 3 ? 'opacity:.85;' : ''}">`;
        row += `<span style="flex:1;">${icon} <span style="font-weight:500;${isCustom ? 'color:var(--verde2)' : ''}">${esc(child)}</span> `
             + `<span style="font-size:.75rem;color:var(--cinza3)">— ${esc(label)}</span></span>`;
        if (isCustom) {
          row += `<button data-cls="${esc(child)}" onclick="removeCustomClass(this.dataset.cls)" `
               + `style="background:none;border:none;cursor:pointer;color:var(--vermelho);font-size:.7rem;padding:0 .2rem;margin-left:.5rem;flex-shrink:0;" `
               + `title="Remover classe">✕</button>`;
        }
        row += `</div>`;
        return row + renderChildren(child, level + 1, new Set([...path, child]));
      }).join('');
    }

    let html = `<div style="font-family: monospace; font-size: 0.9rem; line-height: 1.6;">`;
    ['dre:DocumentoOficial', 'dre:EntidadeEmissora'].forEach(root => {
      if (root === 'dre:EntidadeEmissora' && !(hierarchy[root] || []).length) return;
      html += `<div style="padding-left:0;">🌳 ${root}</div>`;
      html += renderChildren(root, 1, new Set([root]));
    });
    html += `</div>`;

    container.innerHTML = html;
  } catch (err) {
    console.error('Erro ao renderizar ontologia:', err);
    container.innerHTML =
      `<div style="color:var(--vermelho);padding:1rem">Erro ao carregar hierarquia</div>`;
  }
}

// ─── Sidebar de classes OWL ─────────────────────────────────────────────────

async function loadOwlClasses() {
  try {
    const [all, used] = await Promise.all([
      apiFetch('/api/owl-classes-all'),
      apiFetch('/api/owl-classes')
    ]);
    const allClasses = uniqueBy(all, 'cls');
    const usedClasses = uniqueBy(used, 'owl_class');
    const countMap = new Map(usedClasses.map(c => [c.owl_class, c.count]));

    const classList = document.getElementById('owl-class-list');
    if (!classList) return;

    // Mostrar classes com documentos OU explicitamente declaradas
    const displayed = allClasses.filter(c => (countMap.get(c.cls) || 0) > 0 || c.declared);
    classList.innerHTML = displayed.map(c => {
      const count = countMap.get(c.cls) || 0;
      const selected = c.cls === currentClass ? ' selected' : '';
      return `<div class="onto-class${selected}" data-cls="${esc(c.cls)}" onclick="filterByClass(this.dataset.cls, this)" title="${esc(c.cls)}" style="opacity:${count > 0 ? 1 : 0.6}">
        <span class="cls-name">${esc(c.label)}</span>
        <span class="cls-count">${count > 0 ? Number(count).toLocaleString('pt-PT') : '—'}</span>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar classes para sidebar:', err);
  }
}

// ─── Dropdown "Adicionar" ────────────────────────────────────────────────────

function toggleAddDropdown(ev) {
  ev.stopPropagation();
  document.getElementById('addDropdownContainer').classList.toggle('show');
}

// Fecha o dropdown ao clicar fora
window.addEventListener('click', function (e) {
  if (!e.target.matches('#addDropdownContainer button')) {
    const dropdown = document.getElementById('addDropdownContainer');
    if (dropdown && dropdown.classList.contains('show')) {
      dropdown.classList.remove('show');
    }
  }
});

function openAddView(type, ev) {
  if (ev) ev.preventDefault();

  const navBtn = document.querySelector('#addDropdownContainer button');
  showView('adicionar', navBtn);

  const panels = {
    documento: document.getElementById('panel-add-doc'),
    entidade: document.getElementById('panel-add-ent'),
    classe: document.getElementById('panel-add-class')
  };
  Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
  if (panels[type]) panels[type].style.display = 'block';

  // Cada painel carrega apenas os seus próprios selects (sem escritas concorrentes)
  if (type === 'documento') loadRdfDocumentOptions();
  else if (type === 'entidade') loadRdfEntityClasses();
  else if (type === 'classe') loadRdfParentClasses();
}

// ─── Criar classe OWL ────────────────────────────────────────────────────────

const localName = uri => String(uri).split('#').pop();

async function loadRdfParentClasses() {
  const sel = document.getElementById('rdf-parent-class');
  if (!sel) return;
  const previous = sel.value;
  sel.innerHTML = '<option value="">A carregar opções...</option>';

  try {
    const data = await apiFetch('/api/rdf/form-options');
    if (data.error) throw new Error(data.error);

    let html = '<option value="">— selecione a superclasse mãe —</option>';

    if (data.classes_doc && data.classes_doc.length > 0) {
      html += '<optgroup label="Hierarquia de Documentos">';
      html += '<option value="http://dre.pt/ontologia#DocumentoOficial">📄 Documento Oficial (Raiz)</option>';
      data.classes_doc.forEach(c => {
        if (localName(c.uri) !== 'DocumentoOficial') {
          html += `<option value="${esc(c.uri)}">${esc(c.label)}</option>`;
        }
      });
      html += '</optgroup>';
    }

    if (data.entidades && data.entidades.length > 0) {
      html += '<optgroup label="Hierarquia de Entidades">';
      html += '<option value="http://dre.pt/ontologia#EntidadeEmissora">🏛️ Entidade Emissora (Raiz)</option>';
      data.entidades.forEach(c => {
        if (localName(c.uri) !== 'EntidadeEmissora') {
          html += `<option value="${esc(c.uri)}">${esc(c.label)}</option>`;
        }
      });
      html += '</optgroup>';
    }

    sel.innerHTML = html;
    if (previous) sel.value = previous;
    updateClassPreview();
  } catch (err) {
    console.error('Erro ao carregar classes mãe:', err);
    sel.innerHTML = '<option value="">Erro ao carregar (ver consola)</option>';
  }
}

function updateClassPreview() {
  const form = document.querySelector('#panel-add-class form');
  const preview = document.getElementById('new-class-preview');
  if (!form || !preview) return;

  const nome = form.elements.nome_classe.value.trim().replace(/\s+/g, '');
  const parent = form.elements.super_classe.value;
  const label = form.elements.label.value.trim();

  if (!nome || !parent) {
    preview.textContent = 'Preenche o nome e escolhe a superclasse para ver os triplos gerados.';
    return;
  }

  let text = `dre:${nome} a owl:Class ;\n`;
  text += `    rdfs:subClassOf dre:${localName(parent)} ;\n`;
  text += label ? `    rdfs:label "${label}"@pt .\n` : `    .\n`;
  preview.textContent = text;
}

async function addRDFClass(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('btn-submit-rdf-class');
  const originalText = btn.textContent;
  btn.textContent = 'A injetar classe no grafo...';
  btn.disabled = true;

  const body = Object.fromEntries(new FormData(form));

  try {
    const d = await apiFetch('/api/rdf/classe', jsonOpts('POST', body));
    if (d.ok) {
      showToast('✓ Nova Classe OWL adicionada à ontologia!');

      // Guardar a classe personalizada com o URI devolvido pelo servidor
      const parent = body.super_classe.split('#')[1] || body.super_classe;
      saveCustomClass(body.nome_classe, parent, body.label, d.uri);

      form.reset();
      // Atualizar dropdown de superclasses, sidebar e árvore
      await Promise.all([loadRdfParentClasses(), loadOwlClasses(), renderOntologyTree()]);
    } else {
      showToast('Erro: ' + (d.error || 'Falha na inserção'), true);
    }
  } catch (err) {
    console.error('Erro:', err);
    showToast('Erro: ' + err.message, true);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ─── Inserir documento / entidade (RDF) ─────────────────────────────────────

async function loadRdfDocumentOptions() {
  const selType = document.getElementById('rdf-doc-type');
  const listEnt = document.getElementById('rdf-entities-list');

  try {
    const data = await apiFetch('/api/rdf/form-options');
    if (data.error) throw new Error(data.error);

    // 1. Tipos de documento
    if (selType) {
      selType.innerHTML = '<option value="">— selecione o tipo —</option>' +
        (data.classes_doc && data.classes_doc.length > 0
          ? data.classes_doc.map(c => `<option value="${esc(c.uri)}">${esc(c.label)}</option>`).join('')
          : '<option value="" disabled>Nenhum tipo disponível</option>');
    }

    // 2. Entidades emissoras (o rótulo legível vai no value para a pesquisa funcionar)
    if (listEnt) {
      listEnt.innerHTML = (data.entidades && data.entidades.length > 0)
        ? data.entidades.map(en => `<option value="${esc(en.label)}"></option>`).join('')
        : '';
    }
  } catch (err) {
    console.error('Erro ao carregar dados do formulário:', err);
    showToast('Erro ao carregar dados do SQLite para o formulário.', true);
  }
}

async function loadRdfEntityClasses() {
  const sel = document.getElementById('rdf-class-selector');
  if (!sel) return;
  sel.innerHTML = '<option value="">A carregar opções...</option>';

  try {
    const classes = await apiFetch('/api/rdf/classes');
    if (classes.error) throw new Error(classes.error);

    sel.innerHTML = '<option value="">— selecione a classe mãe —</option>' +
      classes.map(c => `<option value="${esc(c.uri)}">${esc(c.label)}</option>`).join('');
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar classes RDF da base de dados.', true);
    sel.innerHTML = '<option value="">Erro ao carregar opções</option>';
  }
}

// Submissão genérica dos formulários RDF de documento / entidade
async function submitRdfForm(e, { btnId, busyText, url, successMsg }) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById(btnId);
  const originalText = btn.textContent;
  btn.textContent = busyText;
  btn.disabled = true;

  const body = Object.fromEntries(new FormData(form));

  try {
    const d = await apiFetch(url, jsonOpts('POST', body));
    if (d.ok) {
      showToast(successMsg);
      form.reset();
      // Atualizar contagens da sidebar e resumo
      loadOwlClasses();
      loadQuickStats();
    } else {
      showToast('Erro: ' + (d.error || 'Falha na inserção'), true);
    }
  } catch (err) {
    console.error(err);
    showToast('Erro: ' + err.message, true);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function addRDFDocument(e) {
  return submitRdfForm(e, {
    btnId: 'btn-submit-rdf-doc',
    busyText: 'A gerar triplos e a comprimir...',
    url: '/api/rdf/documento',
    successMsg: 'Documento injetado na ontologia com sucesso!'
  });
}

function addRDFEntity(e) {
  return submitRdfForm(e, {
    btnId: 'btn-submit-rdf',
    busyText: 'A injetar triplos e a comprimir...',
    url: '/api/rdf/entidade',
    successMsg: 'Entidade injetada com sucesso no ficheiro .bz2!'
  });
}

// ─── Extração de dados de PDF ───────────────────────────────────────────────

async function extractFromPDF() {
  const file = document.getElementById('pdf-upload').files[0];
  if (!file) {
    showToast('Por favor, seleciona um ficheiro PDF primeiro.', true);
    return;
  }

  const btn = document.getElementById('btn-extract-pdf');
  const feedback = document.getElementById('pdf-feedback');
  const originalText = btn.textContent;

  btn.textContent = 'A processar...';
  btn.disabled = true;
  feedback.textContent = 'A analisar texto do documento...';
  feedback.style.color = 'var(--cinza3)';

  const formData = new FormData();
  formData.append('file', file);

  const setField = (selector, value) => {
    const el = document.querySelector('#panel-add-doc ' + selector);
    if (el && value) el.value = value;
  };

  try {
    const data = await apiFetch('/api/extract-pdf', { method: 'POST', body: formData });

    if (data.ok) {
      setField('input[name="data_publicacao"]', data.data_publicacao);
      setField('textarea[name="sumario"]', data.sumario);
      setField('input[name="emitido_por_nome"]', data.emitido_por_nome);

      showToast('Dados do PDF extraídos com sucesso!');
      feedback.textContent = 'Campos preenchidos automaticamente. Por favor, valida a informação.';
      feedback.style.color = 'var(--verde2)';
    } else {
      showToast(data.error || 'Erro na extração', true);
      feedback.textContent = 'Erro ao extrair dados. Preenche manualmente.';
      feedback.style.color = 'var(--vermelho)';
    }
  } catch (err) {
    console.error(err);
    showToast('Erro ao processar PDF: ' + err.message, true);
    feedback.textContent = 'Falha na ligação.';
    feedback.style.color = 'var(--vermelho)';
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ─── Arranque ────────────────────────────────────────────────────────────────

loadOwlClasses();
loadQuickStats();