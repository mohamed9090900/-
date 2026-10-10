(() => {
  'use strict';

  const DB_NAME = 'feasibility_builder_v1';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const STATE_KEY = 'state';
  const APP_VERSION = 5;
  const main = document.getElementById('appMain');
  const modal = document.getElementById('modal');
  const backupFile = document.getElementById('backupFile');
  const toastEl = document.getElementById('toast');

  let state = { version: APP_VERSION, projects: [] };
  let currentProjectId = null;
  let toastTimer = null;
  let activeSearch = '';

  const uid = (p='id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const now = () => new Date().toISOString();
  const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const clamp = (v,min,max) => Math.min(max,Math.max(min,n(v)));
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmt = (v,c='ج') => `${new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n(v))} ${esc(c)}`;
  const fmtNum = v => new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n(v));
  const periodLabel = p => p === 'monthly' ? 'شهري' : 'تأسيس';
  const tagClass = p => p === 'monthly' ? 'monthly' : '';
  const statusLabel = s => s === 'replace' ? 'محتاج بديل' : s === 'research' ? 'قيد المقارنة' : 'مؤكد';
  const statusClass = s => s === 'replace' ? 'replace' : s === 'research' ? 'research' : 'confirmed';

  const coreKindFromName = name => {
    const x=String(name||'').trim().toLowerCase();
    if(/بضاع|مخزون/.test(x)) return 'goods';
    if(/(مصاريف|مصروفات).*شهر|شهر.*(مصاريف|مصروفات)|تشغيل شهري/.test(x)) return 'monthly_expenses';
    return 'generic';
  };
  function ensureCoreSections(p){
    p.sections=Array.isArray(p.sections)?p.sections:[];
    let goods=p.sections.find(x=>x.kind==='goods');
    if(!goods) goods=p.sections.find(x=>coreKindFromName(x.name)==='goods');
    if(goods) goods.kind='goods';
    else goods={id:uid('sec'),name:'البضاعة',notes:'',kind:'goods',categories:[]};

    let monthly=p.sections.find(x=>x.kind==='monthly_expenses');
    if(!monthly) monthly=p.sections.find(x=>x!==goods && coreKindFromName(x.name)==='monthly_expenses');
    if(monthly) monthly.kind='monthly_expenses';
    else monthly={id:uid('sec'),name:'المصاريف الشهرية',notes:'',kind:'monthly_expenses',categories:[]};

    const rest=p.sections.filter(x=>x!==goods && x!==monthly);
    p.sections=[goods,monthly,...rest];
    return p;
  }

  function normalizeState(raw){
    const out = raw && Array.isArray(raw.projects) ? raw : {projects:[]};
    out.version = APP_VERSION;
    out.projects = out.projects.map(p => ({
      ...p,
      images:Array.isArray(p.images)?p.images:[],
      sections:Array.isArray(p.sections)?p.sections:[],
      reserveMonths: Number.isFinite(Number(p.reserveMonths)) ? clamp(p.reserveMonths,0,24) : 3,
      contingencyPct: Number.isFinite(Number(p.contingencyPct)) ? clamp(p.contingencyPct,0,100) : 10,
      weakScenarioPct: Number.isFinite(Number(p.weakScenarioPct)) ? clamp(p.weakScenarioPct,0,300) : 70,
      strongScenarioPct: Number.isFinite(Number(p.strongScenarioPct)) ? clamp(p.strongScenarioPct,0,300) : 130,
      grossMarginPct: Number.isFinite(Number(p.grossMarginPct)) ? clamp(p.grossMarginPct,0,100) : 0,
      revenues: Array.isArray(p.revenues) ? p.revenues : [],
      currency: p.currency || 'ج',
      createdAt:p.createdAt||now(), updatedAt:p.updatedAt||now()
    }));
    for(const p of out.projects){
      p.revenues = (p.revenues||[]).map(r=>({
        id:r.id||uid('rev'), name:r.name||'', mode:r.mode==='monthly'?'monthly':'unit', unit:r.unit||'عملية',
        quantity:Math.max(0,n(r.quantity||0)), frequency:r.frequency==='daily'?'daily':'monthly', workDays:clamp(r.workDays||26,0,31),
        salePrice:Math.max(0,n(r.salePrice||0)), unitCost:Math.max(0,n(r.unitCost||0)),
        monthlyRevenue:Math.max(0,n(r.monthlyRevenue||0)), monthlyDirectCost:Math.max(0,n(r.monthlyDirectCost||0)),
        notes:r.notes||'', updatedAt:r.updatedAt||p.updatedAt||now()
      }));
      for(const s of p.sections){
        s.notes = s.notes || '';
        s.kind = ['goods','monthly_expenses','generic'].includes(s.kind) ? s.kind : 'generic';
        s.categories = Array.isArray(s.categories)?s.categories:[];
        for(const c of s.categories){
          c.notes = c.notes || '';
          c.items = Array.isArray(c.items)?c.items:[];
          for(const it of c.items){
            it.notes=it.notes||''; it.supplier=it.supplier||''; it.status=it.status||'confirmed'; it.updatedAt=it.updatedAt||p.updatedAt||now();
            it.qty=Math.max(0,n(it.qty)); it.unitPrice=Math.max(0,n(it.unitPrice));
            if(it.period==='annual') it.period='startup';
            if(Number.isFinite(Number(it.salePrice))) it.salePrice=Math.max(0,n(it.salePrice));
          }
        }
      }
      // ترحيل الأقسام القديمة تلقائيًا بدون فقد أي بيانات.
      let goodsTaken=false, monthlyTaken=false;
      for(const sec of p.sections){
        const inferred=coreKindFromName(sec.name);
        if(sec.kind==='goods' || (!goodsTaken && inferred==='goods')){ sec.kind='goods'; goodsTaken=true; }
        else if(sec.kind==='monthly_expenses' || (!monthlyTaken && inferred==='monthly_expenses')){ sec.kind='monthly_expenses'; monthlyTaken=true; }
        else if(!['goods','monthly_expenses'].includes(sec.kind)) sec.kind='generic';
      }
      ensureCoreSections(p);
      for(const sec of p.sections){
        if(sec.kind==='goods'){
          for(const cat of sec.categories) for(const it of cat.items){
            if(!Number.isFinite(Number(it.salePrice))) it.salePrice=Math.max(0,n(it.unitPrice));
            it.period='startup';
          }
        } else if(sec.kind==='monthly_expenses'){
          for(const cat of sec.categories) for(const it of cat.items) it.period='monthly';
        }
      }
    }
    return out;
  }

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
  }
  async function dbGet(key){ const db=await openDB(); return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  async function dbSet(key,val){ const db=await openDB(); return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(val,key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);}); }
  async function load(){ const saved=await dbGet(STATE_KEY); if(saved && saved.projects) state=normalizeState(saved); render(); }
  async function save(){ state.version=APP_VERSION; await dbSet(STATE_KEY,state); }
  function touchProject(p){ p.updatedAt=now(); }
  async function commit(msg){ await save(); render(); if(msg) toast(msg); }
  function toast(msg){ clearTimeout(toastTimer); toastEl.textContent=msg; toastEl.classList.add('show'); toastTimer=setTimeout(()=>toastEl.classList.remove('show'),1900); }

  function getProject(){ return state.projects.find(p=>p.id===currentProjectId) || null; }
  function getSection(p,id){ return p?.sections.find(x=>x.id===id); }
  function getCategory(section,id){ return section?.categories.find(x=>x.id===id); }
  function getItem(cat,id){ return cat?.items.find(x=>x.id===id); }
  function getRevenue(p,id){ return p?.revenues?.find(x=>x.id===id); }

  function calcItems(items=[]){
    const r={startup:0,monthly:0,annual:0,count:0};
    for(const it of items){ const total=n(it.qty)*n(it.unitPrice); const period=it.period==='monthly'?'monthly':'startup'; r[period] += total; r.count++; }
    r.firstYear=r.startup+(r.monthly*12); return r;
  }
  function calcCategory(cat,kind='generic'){
    if(kind==='goods'){
      const r={startup:0,monthly:0,annual:0,count:0,purchase:0,sales:0,profit:0};
      for(const it of (cat.items||[])){
        const qty=Math.max(0,n(it.qty)), purchase=qty*Math.max(0,n(it.unitPrice)), sales=qty*Math.max(0,n(it.salePrice));
        r.purchase+=purchase; r.sales+=sales; r.profit+=sales-purchase; r.startup+=purchase; r.count++;
      }
      r.firstYear=r.startup; return r;
    }
    if(kind==='monthly_expenses'){
      const r={startup:0,monthly:0,annual:0,count:0};
      for(const it of (cat.items||[])){ r.monthly+=Math.max(0,n(it.qty))*Math.max(0,n(it.unitPrice)); r.count++; }
      r.firstYear=r.monthly*12; return r;
    }
    return calcItems(cat.items);
  }
  function calcSection(section){
    const r={startup:0,monthly:0,annual:0,count:0,purchase:0,sales:0,profit:0};
    for(const cat of (section.categories||[])){
      const x=calcCategory(cat,section.kind||'generic');
      r.startup+=x.startup||0; r.monthly+=x.monthly||0; r.annual+=x.annual||0; r.count+=x.count||0;
      r.purchase+=x.purchase||0; r.sales+=x.sales||0; r.profit+=x.profit||0;
    }
    r.firstYear=r.startup+(r.monthly*12); return r;
  }
  function calcProject(p){
    const r={startup:0,monthly:0,annual:0,count:0,sections:p.sections.length,categories:0};
    for(const sec of p.sections){
      const x=calcSection(sec);
      r.startup+=x.startup; r.monthly+=x.monthly; r.annual+=x.annual; r.count+=x.count; r.categories+=(sec.categories||[]).length;
    }
    r.firstYear=r.startup+(r.monthly*12);
    r.reserveMonths=clamp(p.reserveMonths ?? 3,0,24);
    r.contingencyPct=clamp(p.contingencyPct ?? 10,0,100);
    r.operatingReserve=r.monthly*r.reserveMonths;
    r.capitalBeforeContingency=r.startup+r.operatingReserve;
    r.contingency=r.capitalBeforeContingency*(r.contingencyPct/100);
    r.openingCapital=r.capitalBeforeContingency+r.contingency;
    return r;
  }
  function calcGoods(p){
    const out={purchase:0,sales:0,profit:0,count:0};
    for(const sec of (p.sections||[]).filter(x=>x.kind==='goods')){
      const x=calcSection(sec); out.purchase+=x.purchase||0; out.sales+=x.sales||0; out.profit+=x.profit||0; out.count+=x.count||0;
    }
    return out;
  }
  function calcBreakEven(p,c=calcProject(p)){
    const monthlyExpenses=Math.max(0,n(c.monthly));
    const grossMarginPct=clamp(p.grossMarginPct ?? 0,0,100);
    const margin=grossMarginPct/100;
    const breakEvenSales=monthlyExpenses===0 ? 0 : margin>0 ? monthlyExpenses/margin : null;
    return {monthlyExpenses,grossMarginPct,breakEvenSales};
  }

  function calcRevenueSource(src,factor=1){
    factor=Math.max(0,n(factor));
    if((src?.mode||'unit')==='monthly'){
      const revenue=Math.max(0,n(src.monthlyRevenue))*factor;
      const directCost=Math.max(0,n(src.monthlyDirectCost))*factor;
      return {monthlyQty:null,revenue,directCost,contribution:revenue-directCost};
    }
    const baseQty=Math.max(0,n(src?.quantity));
    const workDays=(src?.frequency==='daily')?clamp(src?.workDays||26,0,31):1;
    const monthlyQty=baseQty*workDays*factor;
    const revenue=monthlyQty*Math.max(0,n(src?.salePrice));
    const directCost=monthlyQty*Math.max(0,n(src?.unitCost));
    return {monthlyQty,revenue,directCost,contribution:revenue-directCost};
  }
  function calcRevenues(p,factor=1){
    const out={revenue:0,directCost:0,contribution:0,count:(p.revenues||[]).length};
    for(const src of (p.revenues||[])){const x=calcRevenueSource(src,factor);out.revenue+=x.revenue;out.directCost+=x.directCost;out.contribution+=x.contribution;}
    return out;
  }
  function calcScenario(p,c,pct=100){
    const factor=clamp(pct,0,300)/100;
    const rev=calcRevenues(p,factor);
    const fixedMonthly=c.monthly;
    const grossMargin=rev.revenue>0?rev.contribution/rev.revenue:0;
    const netProfit=rev.contribution-fixedMonthly;
    const netMargin=rev.revenue>0?netProfit/rev.revenue:0;
    const breakEvenSales=grossMargin>0?fixedMonthly/grossMargin:null;
    const paybackMonths=netProfit>0?c.openingCapital/netProfit:null;
    return {...rev,pct:factor*100,fixedMonthly,grossMargin,netProfit,netMargin,breakEvenSales,paybackMonths,annualOperatingProfit:netProfit*12};
  }

  function render(){ if(currentProjectId && !getProject()) currentProjectId=null; currentProjectId ? renderProject() : renderHome(); }

  function renderHome(){
    const cards=state.projects.map(p=>{
      const c=calcProject(p); const cover=p.images?.[0]?.data;
      return `<article class="card project-card" data-action="open-project" data-id="${p.id}">
        <div class="project-cover">${cover?`<img src="${cover}" alt="">`:''}<span class="badge">${c.sections} أقسام • ${c.count} عناصر</span></div>
        <div class="project-card-body">
          <div class="meta">${esc(p.location || 'بدون مكان محدد')}${p.area ? ` • ${esc(p.area)}` : ''}</div>
          <h2 class="project-title">${esc(p.name)}</h2>
          <div class="project-total"><div><div class="caption">رأس المال المطلوب للبدء</div><div class="big-number">${fmt(c.openingCapital,p.currency)}</div><div class="caption">يشمل احتياطي تشغيل ${c.reserveMonths} شهر + طوارئ ${fmtNum(c.contingencyPct)}% • مصروف شهري ${fmt(c.monthly,p.currency)}</div></div><span class="btn small">فتح</span></div>
        </div>
      </article>`;
    }).join('');
    main.innerHTML=`
      <div class="hero"><div><h1>مشروعاتي</h1><p>أنشئ دراسة لأي مشروع بالطريقة اللي تناسبك. إنت اللي بتحدد الأقسام والفئات والعناصر، والبرنامج يرتب التكاليف ويطلع لك رقم رأس المال المطلوب.</p></div><div class="spacer"></div><button class="btn primary" data-action="new-project">+ مشروع جديد</button></div>
      <div class="grid project-grid">${cards || `<div class="card empty"><div class="empty-icon">📊</div><strong>ابدأ أول دراسة</strong>اعمل مشروع جديد، وبعدها قسّمه بالطريقة اللي تناسب نشاطك.</div>`}</div>`;
  }

  function renderProject(){
    const p=getProject(), c=calcProject(p);
    const sections=p.sections.map((s,i)=>renderSection(p,s,i)).join('');
    const photos=(p.images||[]).map(img=>`<div class="photo"><img src="${img.data}" alt=""><button title="حذف الصورة" data-action="delete-project-photo" data-photo-id="${img.id}">×</button></div>`).join('');
    main.innerHTML=`
      <div class="backline"><button class="btn ghost small" data-action="go-home">← المشروعات</button><span class="meta">آخر تعديل ${new Date(p.updatedAt).toLocaleString('ar-EG')}</span></div>
      <div class="project-head">
        <div><h1>${esc(p.name)}</h1><div class="meta">${esc(p.location||'')}${p.area?` • ${esc(p.area)}`:''}</div>${p.description?`<p class="project-desc">${esc(p.description)}</p>`:''}</div>
        <div class="head-actions"><button class="btn ghost" data-action="edit-project">إعدادات الدراسة</button><button class="btn ghost" data-action="print-project">طباعة / PDF</button></div>
      </div>

      <section class="card capital-hero">
        <div class="capital-label">رأس المال المطلوب لافتتاح المشروع</div>
        <div class="capital-value">${fmt(c.openingCapital,p.currency)}</div>
        <div class="capital-break">
          <div class="capital-chip">تكاليف التأسيس <b>${fmt(c.startup,p.currency)}</b></div>
          <div class="capital-chip">احتياطي تشغيل ${c.reserveMonths} شهر <b>${fmt(c.operatingReserve,p.currency)}</b></div>
          <div class="capital-chip">طوارئ ${fmtNum(c.contingencyPct)}% <b>${fmt(c.contingency,p.currency)}</b></div>
        </div>
      </section>

      <div class="stats">
        <div class="card stat"><div class="label">تكاليف التأسيس</div><div class="value">${fmt(c.startup,p.currency)}</div><div class="sub">كل ما ستدفعه مرة واحدة قبل أو وقت الافتتاح</div></div>
        <div class="card stat"><div class="label">المصروفات الشهرية</div><div class="value">${fmt(c.monthly,p.currency)}</div><div class="sub">إيجار، مرتبات، كهرباء، خدمات وباقي التشغيل الشهري</div></div>
      </div>
      <div class="info-strip"><span>💡</span><div><b>احتياطي التشغيل والطوارئ قابلين للتعديل.</b> الاحتياطي مش مصروف فعلي؛ هو سيولة تحميك في بداية التشغيل. عدّل عدد الشهور ونسبة الطوارئ من «إعدادات الدراسة» حسب طبيعة المشروع.</div></div>

      ${renderBreakEven(p,c)}

      <div class="card photos-box"><div class="photos-box-head"><h3>صور ومراجع المشروع</h3><div class="spacer"></div><button class="btn small" data-action="add-project-photo">+ إضافة صورة</button></div><div class="photos">${photos || '<span class="meta">أضف صور المكان، أفكار التصميم، عروض أسعار أو أي مرجع بصري يساعدك.</span>'}</div><input id="projectPhotoInput" class="file-hidden" type="file" accept="image/*"></div>

      <div class="section-toolbar"><h2>تفاصيل الدراسة</h2><div class="searchbox"><span>⌕</span><input id="projectSearch" type="search" placeholder="ابحث عن عنصر، مورد أو ملاحظة…" value="${esc(activeSearch)}"></div><div class="spacer"></div><button class="btn primary" data-action="new-section">+ قسم رئيسي</button></div>
      ${sections || `<div class="card empty"><div class="empty-icon">🧩</div><strong>ابدأ تقسيم المشروع</strong>مثلاً: بضاعة، معدات، مكان، تشطيب، تراخيص… أو أي تقسيم يناسبك.</div>`}
      ${renderSummary(p,c)}
      <div class="danger-zone"><strong>حذف المشروع</strong><div class="mini-note">الحذف نهائي من الجهاز. خُد نسخة احتياطية لو محتاج تحتفظ به.</div><button class="btn danger small" style="margin-top:9px" data-action="delete-project">حذف المشروع</button></div>`;
    if(activeSearch) applySearch(activeSearch);
  }

  function renderSection(p,s,index){
    const cs=calcSection(s);
    const cats=s.categories.map(cat=>renderCategory(p,s,cat)).join('');
    let metrics='';
    if(s.kind==='goods') metrics=`<div class="metric-line">تكلفة البضاعة <b>${fmt(cs.purchase,p.currency)}</b></div>`;
    else if(s.kind==='monthly_expenses') metrics=`<div class="metric-line">إجمالي شهري <b>${fmt(cs.monthly,p.currency)}</b></div>`;
    else metrics=`<div class="metric-line">تأسيس <b>${fmt(cs.startup,p.currency)}</b></div><div class="metric-line">شهري <b>${fmt(cs.monthly,p.currency)}</b></div>`;
    const fixed=s.kind==='goods'||s.kind==='monthly_expenses';
    return `<section class="card section-block" data-section-search="${esc(`${s.name} ${s.notes||''}`.toLowerCase())}">
      <div class="section-header">
        <div class="section-index">${index+1}</div>
        <div><h3>${esc(s.name)} ${fixed?'<span class="section-kind-badge">ثابت</span>':''}</h3>${s.notes?`<div class="section-note">${esc(s.notes)}</div>`:''}</div>
        <div class="section-metrics">${metrics}</div>
        <div class="section-actions">${fixed?'':`<button class="btn ghost small" data-action="edit-section" data-section-id="${s.id}">تعديل</button><button class="btn danger small" data-action="delete-section" data-section-id="${s.id}">حذف</button>`}</div>
      </div>
      <div class="section-body">${cats || '<div class="empty" style="padding:18px"><strong style="font-size:16px">القسم فاضي</strong>أضف فئة بداخله.</div>'}<button class="btn small" data-action="new-category" data-section-id="${s.id}">+ إضافة فئة</button></div>
    </section>`;
  }

  function renderCategory(p,s,cat){
    const kind=s.kind||'generic', cc=calcCategory(cat,kind);
    const catSearch=`${cat.name} ${cat.notes||''}`.toLowerCase();
    let rows='', table='';
    if(kind==='goods'){
      rows=cat.items.map(it=>{
        const qty=Math.max(0,n(it.qty)), purchase=qty*Math.max(0,n(it.unitPrice));
        const searchText=`${it.name} ${it.supplier||''} ${it.notes||''}`.toLowerCase();
        return `<tr data-item-search="${esc(searchText)}"><td data-label="الصنف"><div class="item-name">${it.image?`<img class="thumb" src="${it.image}" alt="">`:''}<span>${esc(it.name)}</span></div></td><td data-label="الكمية">${fmtNum(qty)} ${esc(it.unit||'')}</td><td data-label="سعر الشراء">${fmt(it.unitPrice,p.currency)}</td><td data-label="إجمالي الشراء"><b>${fmt(purchase,p.currency)}</b></td><td data-label="المورد"><div class="item-supplier">${esc(it.supplier||'—')}</div></td><td data-label="ملاحظات"><div class="item-note">${esc(it.notes||'—')}</div></td><td data-label="إجراءات"><button class="btn ghost small" data-action="edit-item" data-section-id="${s.id}" data-category-id="${cat.id}" data-item-id="${it.id}">تعديل</button> <button class="btn danger small" data-action="delete-item" data-section-id="${s.id}" data-category-id="${cat.id}" data-item-id="${it.id}">حذف</button></td></tr>`;
      }).join('');
      table=rows?`<div class="items"><table class="item-table goods-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الشراء</th><th>إجمالي الشراء</th><th>المورد</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="category-empty">لسه مفيش أصناف في الفئة دي.</div>';
    } else if(kind==='monthly_expenses'){
      rows=cat.items.map(it=>{
        const total=Math.max(0,n(it.qty))*Math.max(0,n(it.unitPrice)); const searchText=`${it.name} ${it.notes||''}`.toLowerCase();
        return `<tr data-item-search="${esc(searchText)}"><td data-label="البند"><div class="item-name"><span>${esc(it.name)}</span></div></td><td data-label="العدد">${fmtNum(it.qty)} ${esc(it.unit||'')}</td><td data-label="القيمة الشهرية للوحدة">${fmt(it.unitPrice,p.currency)}</td><td data-label="الإجمالي الشهري"><b>${fmt(total,p.currency)}</b></td><td data-label="ملاحظات"><div class="item-note">${esc(it.notes||'—')}</div></td><td data-label="إجراءات"><button class="btn ghost small" data-action="edit-item" data-section-id="${s.id}" data-category-id="${cat.id}" data-item-id="${it.id}">تعديل</button> <button class="btn danger small" data-action="delete-item" data-section-id="${s.id}" data-category-id="${cat.id}" data-item-id="${it.id}">حذف</button></td></tr>`;
      }).join('');
      table=rows?`<div class="items"><table class="item-table monthly-table"><thead><tr><th>البند</th><th>العدد</th><th>القيمة الشهرية للوحدة</th><th>الإجمالي الشهري</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="category-empty">لسه مفيش مصاريف في الفئة دي.</div>';
    } else {
      rows=cat.items.map(it=>{
        const total=n(it.qty)*n(it.unitPrice); const searchText=`${it.name} ${it.supplier||''} ${it.notes||''} ${statusLabel(it.status)}`.toLowerCase();
        return `<tr data-item-search="${esc(searchText)}"><td data-label="العنصر"><div class="item-name">${it.image?`<img class="thumb" src="${it.image}" alt="">`:''}<span>${esc(it.name)}</span></div></td><td data-label="الكمية">${fmtNum(it.qty)} ${esc(it.unit||'')}</td><td data-label="سعر الوحدة">${fmt(it.unitPrice,p.currency)}</td><td data-label="الإجمالي"><b>${fmt(total,p.currency)}</b></td><td data-label="نوع التكلفة"><span class="tag ${tagClass(it.period)}">${periodLabel(it.period)}</span></td><td data-label="الحالة"><span class="status ${statusClass(it.status)}">${statusLabel(it.status)}</span></td><td data-label="المورد / المكان"><div class="item-supplier">${esc(it.supplier||'—')}</div></td><td data-label="ملاحظات"><div class="item-note">${esc(it.notes||'—')}</div></td><td data-label="إجراءات"><button class="btn ghost small" data-action="edit-item" data-section-id="${s.id}" data-category-id="${cat.id}" data-item-id="${it.id}">تعديل</button> <button class="btn danger small" data-action="delete-item" data-section-id="${s.id}" data-category-id="${cat.id}" data-item-id="${it.id}">حذف</button></td></tr>`;
      }).join('');
      table=rows?`<div class="items"><table class="item-table"><thead><tr><th>العنصر</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>التكلفة</th><th>الحالة</th><th>المورد / المكان</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="category-empty">لسه مفيش عناصر في الفئة دي.</div>';
    }
    let totals='';
    if(kind==='goods') totals=`${cat.items.length} أصناف • إجمالي تكلفة الشراء <b>${fmt(cc.purchase,p.currency)}</b>`;
    else if(kind==='monthly_expenses') totals=`${cat.items.length} بنود • إجمالي شهري <b>${fmt(cc.monthly,p.currency)}</b>`;
    else totals=`${cat.items.length} عناصر • تأسيس <b>${fmt(cc.startup,p.currency)}</b> • شهري <b>${fmt(cc.monthly,p.currency)}</b>`;
    return `<div class="category" data-category-search="${esc(catSearch)}"><div class="category-head"><div><h4>${esc(cat.name)}</h4>${cat.notes?`<div class="category-note">${esc(cat.notes)}</div>`:''}<div class="category-totals">${totals}</div></div><div class="category-actions"><button class="btn small" data-action="new-item" data-section-id="${s.id}" data-category-id="${cat.id}">+ ${kind==='goods'?'صنف':kind==='monthly_expenses'?'بند':'عنصر'}</button><button class="btn ghost small" data-action="edit-category" data-section-id="${s.id}" data-category-id="${cat.id}">تعديل</button><button class="btn danger small" data-action="delete-category" data-section-id="${s.id}" data-category-id="${cat.id}">حذف</button></div></div>${table}</div>`;
  }

  function moneyOrDash(v,p){ return v===null || !Number.isFinite(Number(v)) ? '—' : fmt(v,p.currency); }
  function monthsOrDash(v){ return v===null || !Number.isFinite(Number(v)) ? '—' : `${fmtNum(v)} شهر`; }
  function profitTone(v){ return n(v)>0?'positive':n(v)<0?'negative':'neutral'; }
  function renderBreakEven(p,c){
    const x=calcBreakEven(p,c);
    const breakEvenText=x.breakEvenSales===null?'حدد هامش الربح':fmt(x.breakEvenSales,p.currency);
    return `<section class="card simple-profit">
      <div class="simple-profit-head"><div><span class="eyebrow">نقطة التعادل</span><h2>محتاج مبيعات كام كل شهر؟</h2></div></div>
      <div class="simple-profit-grid">
        <div class="simple-profit-card"><span>المصروفات الشهرية</span><strong>${fmt(x.monthlyExpenses,p.currency)}</strong><small>بتتجمع تلقائيًا من قسم المصروفات الشهرية</small></div>
        <div class="simple-profit-card"><span>متوسط هامش مجمل الربح</span><strong>${fmtNum(x.grossMarginPct)}%</strong><small>عدّله من إعدادات الدراسة</small></div>
        <div class="simple-profit-card final"><span>مبيعات نقطة التعادل / شهر</span><strong>${breakEvenText}</strong><small>${x.breakEvenSales===null?'أدخل نسبة هامش مجمل الربح أولًا':'عند هذا المستوى تغطي المصروفات الشهرية بدون ربح أو خسارة'}</small></div>
      </div>
      <div class="simple-profit-note">مثال: هامش 15% يعني أن كل 100 جنيه مبيعات يساهم منها 15 جنيه في تغطية المصروفات الشهرية.</div>
    </section>`;
  }

  function renderFinancialAnalysis(p,c){
    const has=(p.revenues||[]).length>0;
    const weakPct=clamp(p.weakScenarioPct ?? 70,0,300), strongPct=clamp(p.strongScenarioPct ?? 130,0,300);
    const scenarios=[['ضعيف',weakPct],['متوقع',100],['ممتاز',strongPct]].map(([name,pct])=>({name,pct,x:calcScenario(p,c,pct)}));
    if(!has) return `<section class="card finance-shell"><div class="finance-title"><div><span class="eyebrow">الجدوى المالية</span><h2>الإيرادات والربحية</h2><p>لما تضيف أول مصدر دخل، البرنامج هيحسب لك 3 سيناريوهات والربح ونقطة التعادل واسترداد رأس المال تلقائيًا.</p></div><button class="btn accent" data-action="new-revenue">+ مصدر دخل</button></div><div class="finance-empty"><div class="empty-icon">💰</div><strong>لسه مفيش إيرادات متوقعة</strong><span>أضف مبيعات أو خدمة أو اشتراك أو أي مصدر دخل للمشروع.</span></div></section>`;
    const expected=scenarios[1].x;
    const cards=scenarios.map(({name,pct,x})=>`<div class="scenario-card ${name==='متوقع'?'expected':''}"><div class="scenario-top"><span>${name}</span><b>${fmtNum(pct)}%</b></div><div class="scenario-sales"><small>مبيعات شهرية</small><strong>${fmt(x.revenue,p.currency)}</strong></div><div class="scenario-profit ${profitTone(x.netProfit)}"><small>${x.netProfit>=0?'ربح':'خسارة'} شهري تقديري</small><strong>${fmt(Math.abs(x.netProfit),p.currency)}</strong></div><div class="scenario-foot"><span>استرداد رأس المال</span><b>${monthsOrDash(x.paybackMonths)}</b></div></div>`).join('');
    return `<section class="card finance-shell"><div class="finance-title"><div><span class="eyebrow">الجدوى المالية</span><h2>هل المشروع قادر يكسب؟</h2><p>السيناريوهات تغيّر حجم المبيعات فقط، بينما المصروفات الثابتة تفضل كما هي.</p></div><button class="btn accent" data-action="new-revenue">+ مصدر دخل</button></div><div class="scenario-grid">${cards}</div><div class="finance-kpis"><div><span>التكلفة المباشرة / شهر</span><b>${fmt(expected.directCost,p.currency)}</b></div><div><span>مجمل الربح / شهر</span><b>${fmt(expected.contribution,p.currency)}</b></div><div><span>تشغيل ثابت / شهر</span><b>${fmt(expected.fixedMonthly,p.currency)}</b><small>يشمل المصروف الشهري + 1/12 من السنوي</small></div><div class="${profitTone(expected.netProfit)}"><span>صافي تشغيلي متوقع</span><b>${fmt(expected.netProfit,p.currency)}</b></div><div><span>مبيعات نقطة التعادل</span><b>${moneyOrDash(expected.breakEvenSales,p)}</b></div><div><span>استرداد رأس المال</span><b>${monthsOrDash(expected.paybackMonths)}</b></div></div><div class="finance-note">الحسبة تقديرية قبل الضرائب والتمويل والاستهلاك. «التكلفة المباشرة» هي تكلفة السلعة/الخامة/الخدمة اللي بتزيد مع كل عملية بيع.</div></section>`;
  }
  function renderRevenueSources(p){
    const rows=(p.revenues||[]).map(src=>{const x=calcRevenueSource(src,1);const how=src.mode==='monthly'?'إجمالي شهري مباشر':`${fmtNum(src.quantity)} ${esc(src.unit||'عملية')} ${src.frequency==='daily'?`يوميًا × ${fmtNum(src.workDays)} يوم`:'شهريًا'}`;return `<tr><td data-label="مصدر الدخل"><b>${esc(src.name)}</b>${src.notes?`<div class="item-note">${esc(src.notes)}</div>`:''}</td><td data-label="طريقة الحساب">${how}</td><td data-label="مبيعات شهرية"><b>${fmt(x.revenue,p.currency)}</b></td><td data-label="تكلفة مباشرة">${fmt(x.directCost,p.currency)}</td><td data-label="مجمل الربح"><b>${fmt(x.contribution,p.currency)}</b></td><td data-label="إجراءات"><button class="btn ghost small" data-action="edit-revenue" data-revenue-id="${src.id}">تعديل</button> <button class="btn danger small" data-action="delete-revenue" data-revenue-id="${src.id}">حذف</button></td></tr>`}).join('');
    return `<section class="card revenue-shell"><div class="revenue-head"><div><span class="eyebrow">مصادر الدخل</span><h3>المبيعات والإيرادات</h3><p>اكتب كل مصدر دخل بالطريقة اللي تناسبه: كمية × سعر، أو إجمالي شهري مباشر.</p></div><button class="btn primary" data-action="new-revenue">+ إضافة مصدر</button></div>${rows?`<div class="revenue-table-wrap"><table class="revenue-table"><thead><tr><th>مصدر الدخل</th><th>طريقة الحساب</th><th>مبيعات شهرية</th><th>تكلفة مباشرة</th><th>مجمل الربح</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="category-empty">لسه مفيش مصادر دخل.</div>`}</section>`;
  }

  function renderSummary(p,c){
    if(!p.sections.length) return '';
    const rows=p.sections.map(s=>{const x=calcSection(s);return `<div class="break-row"><span><b>${esc(s.name)}</b></span><small>شهري ${fmt(x.monthly,p.currency)}</small><b>تأسيس ${fmt(x.startup,p.currency)}</b></div>`}).join('');
    return `<div class="summary-wrap">
      <section class="card summary"><h3>ملخص الأقسام</h3><div class="breakdown">${rows}</div></section>
      <section class="card capital-formula"><h3>حسبة رأس المال</h3>
        <div class="formula-row"><span>تكاليف التأسيس</span><b>${fmt(c.startup,p.currency)}</b></div>
        <div class="formula-row"><span>احتياطي تشغيل (${c.reserveMonths} شهر)</span><b>${fmt(c.operatingReserve,p.currency)}</b></div>
        <div class="formula-row"><span>احتياطي طوارئ (${fmtNum(c.contingencyPct)}%)</span><b>${fmt(c.contingency,p.currency)}</b></div>
        <div class="formula-row total"><span>رأس المال المطلوب</span><b>${fmt(c.openingCapital,p.currency)}</b></div>
        <div class="formula-note">لو مشروعك لا يحتاج احتياطي تشغيل أو طوارئ، تقدر تخلي أي قيمة منهم صفر من إعدادات الدراسة.</div>
      </section>
    </div>`;
  }

  function openModal(title,html,saveLabel='حفظ'){
    modal.innerHTML=`<div class="modal-head"><h3>${esc(title)}</h3><div class="spacer"></div><button class="btn ghost small" type="button" data-action="close-modal">إغلاق</button></div><div class="modal-body">${html}</div><div class="modal-foot"><button class="btn primary" type="submit" form="modalForm">${esc(saveLabel)}</button><button class="btn ghost" type="button" data-action="close-modal">إلغاء</button></div>`;
    modal.showModal();
    setTimeout(()=>modal.querySelector('input:not([type=file]),textarea,select')?.focus(),20);
  }
  function closeModal(){ modal.close(); modal.innerHTML=''; }

  function projectForm(p=null){
    openModal(p?'إعدادات الدراسة':'مشروع جديد',`<form id="modalForm" data-form="project" data-id="${p?.id||''}"><div class="form-grid">
      <div class="field full"><label>اسم المشروع *</label><input name="name" required maxlength="100" value="${esc(p?.name||'')}"></div>
      <div class="field"><label>المكان</label><input name="location" maxlength="120" placeholder="مثلاً: 6 أكتوبر" value="${esc(p?.location||'')}"></div>
      <div class="field"><label>المساحة / وصف المكان</label><input name="area" maxlength="120" placeholder="مثلاً: 120 م²" value="${esc(p?.area||'')}"></div>
      <div class="field"><label>العملة</label><input name="currency" maxlength="12" value="${esc(p?.currency||'ج')}"></div>
      <div class="field"><label>احتياطي تشغيل — عدد الشهور</label><input name="reserveMonths" type="number" min="0" max="24" step="1" value="${p?.reserveMonths ?? 3}"><div class="hint">سيولة إضافية تساوي المصروف الشهري × عدد الشهور. اجعلها 0 لو مش عايز تحسبها.</div></div>
      <div class="field"><label>احتياطي طوارئ %</label><input name="contingencyPct" type="number" min="0" max="100" step="0.5" value="${p?.contingencyPct ?? 10}"><div class="hint">نسبة فوق التأسيس + احتياطي التشغيل لمواجهة فرق الأسعار والمفاجآت.</div></div>
      <div class="field"><label>متوسط هامش مجمل الربح %</label><input name="grossMarginPct" type="number" min="0" max="100" step="0.1" value="${p?.grossMarginPct ?? 0}"><div class="hint">استخدم نسبة تقديرية للمشروع كله. مثال: 15 يعني أن كل 100 جنيه مبيعات يساهم منها 15 جنيه في تغطية المصروفات.</div></div>
      <div class="field full"><label>وصف / ملاحظات عامة</label><textarea name="description" placeholder="فكرة المشروع، الجمهور، أي ملاحظات مهمة…">${esc(p?.description||'')}</textarea></div>
      <div class="inline-summary">الرقم الرئيسي في الدراسة هيكون: <b>تكاليف التأسيس + احتياطي التشغيل + احتياطي الطوارئ</b>.</div>
    </div></form>`);
  }
  function revenueForm(src=null){
    openModal(src?'تعديل مصدر الدخل':'إضافة مصدر دخل',`<form id="modalForm" data-form="revenue" data-id="${src?.id||''}"><div class="form-grid">
      <div class="field full"><label>اسم مصدر الدخل *</label><input name="name" required maxlength="120" placeholder="مثلاً: مبيعات السوبر ماركت / غسيل سيارات / اشتراكات" value="${esc(src?.name||'')}"></div>
      <div class="field full"><label>طريقة الحساب</label><select name="mode" id="revenueMode"><option value="unit" ${src?.mode!=='monthly'?'selected':''}>كمية × سعر</option><option value="monthly" ${src?.mode==='monthly'?'selected':''}>إجمالي شهري مباشر</option></select><div class="hint">لو عندك متوسط فاتورة أو سعر خدمة استخدم «كمية × سعر». ولو عندك توقع مبيعات شهري جاهز استخدم «إجمالي شهري مباشر».</div></div>
      <div class="field revenue-unit"><label>الكمية المتوقعة</label><input name="quantity" min="0" step="any" type="number" value="${src?.quantity ?? 0}"></div>
      <div class="field revenue-unit"><label>الوحدة</label><input name="unit" maxlength="50" placeholder="طلب / عميل / قطعة…" value="${esc(src?.unit||'عملية')}"></div>
      <div class="field revenue-unit"><label>تكرار الكمية</label><select name="frequency" id="revenueFrequency"><option value="monthly" ${src?.frequency!=='daily'?'selected':''}>شهريًا</option><option value="daily" ${src?.frequency==='daily'?'selected':''}>يوميًا</option></select></div>
      <div class="field revenue-unit revenue-days"><label>أيام العمل / شهر</label><input name="workDays" min="0" max="31" step="1" type="number" value="${src?.workDays ?? 26}"></div>
      <div class="field revenue-unit"><label>سعر البيع / متوسط الفاتورة</label><input name="salePrice" min="0" step="any" type="number" value="${src?.salePrice ?? 0}"></div>
      <div class="field revenue-unit"><label>التكلفة المباشرة للوحدة</label><input name="unitCost" min="0" step="any" type="number" value="${src?.unitCost ?? 0}"><div class="hint">مثلاً تكلفة شراء السلعة أو الخامة المستخدمة في الخدمة.</div></div>
      <div class="field revenue-monthly"><label>المبيعات الشهرية المتوقعة</label><input name="monthlyRevenue" min="0" step="any" type="number" value="${src?.monthlyRevenue ?? 0}"></div>
      <div class="field revenue-monthly"><label>التكلفة المباشرة الشهرية</label><input name="monthlyDirectCost" min="0" step="any" type="number" value="${src?.monthlyDirectCost ?? 0}"></div>
      <div class="field full"><label>ملاحظات</label><textarea name="notes" placeholder="مصدر التقدير، موسم معين، سعر محتاج مراجعة…">${esc(src?.notes||'')}</textarea></div>
      <div class="inline-summary" id="revenuePreview">هنا هتشوف تقدير المبيعات ومجمل الربح الشهري قبل الحفظ.</div>
    </div></form>`);
    updateRevenueFormVisibility(); updateRevenuePreview();
  }
  function updateRevenueFormVisibility(){
    const f=modal.querySelector('#modalForm[data-form="revenue"]'); if(!f) return;
    const monthly=f.querySelector('[name="mode"]')?.value==='monthly';
    f.querySelectorAll('.revenue-unit').forEach(el=>el.style.display=monthly?'none':'flex');
    f.querySelectorAll('.revenue-monthly').forEach(el=>el.style.display=monthly?'flex':'none');
    const daily=!monthly && f.querySelector('[name="frequency"]')?.value==='daily';
    f.querySelectorAll('.revenue-days').forEach(el=>el.style.display=daily?'flex':'none');
  }
  function updateRevenuePreview(){
    const f=modal.querySelector('#modalForm[data-form="revenue"]'), box=modal.querySelector('#revenuePreview'); if(!f||!box) return;
    const fd=new FormData(f); const src={mode:fd.get('mode'),quantity:n(fd.get('quantity')),unit:fd.get('unit'),frequency:fd.get('frequency'),workDays:n(fd.get('workDays')),salePrice:n(fd.get('salePrice')),unitCost:n(fd.get('unitCost')),monthlyRevenue:n(fd.get('monthlyRevenue')),monthlyDirectCost:n(fd.get('monthlyDirectCost'))};
    const x=calcRevenueSource(src,1), p=getProject(); box.innerHTML=`مبيعات شهرية <b>${fmt(x.revenue,p?.currency||'ج')}</b> • تكلفة مباشرة <b>${fmt(x.directCost,p?.currency||'ج')}</b> • مجمل ربح <b>${fmt(x.contribution,p?.currency||'ج')}</b>`;
  }

  function sectionForm(s=null){
    openModal(s?'تعديل القسم':'إضافة قسم رئيسي',`<form id="modalForm" data-form="section" data-id="${s?.id||''}"><div class="form-grid"><div class="field full"><label>اسم القسم *</label><input name="name" required maxlength="100" placeholder="مثلاً: بضاعة / معدات / مكان / تشطيب" value="${esc(s?.name||'')}"></div><div class="field full"><label>ملاحظات القسم</label><textarea name="notes" placeholder="مثلاً: البضاعة الأساسية هتتجاب من مورد معين، وبعد كده هقارن موردين تانيين…">${esc(s?.notes||'')}</textarea></div></div></form>`);
  }
  function categoryForm(sectionId,cat=null){
    openModal(cat?'تعديل الفئة':'إضافة فئة',`<form id="modalForm" data-form="category" data-section-id="${sectionId}" data-id="${cat?.id||''}"><div class="form-grid"><div class="field full"><label>اسم الفئة *</label><input name="name" required maxlength="100" placeholder="مثلاً: ألبان وجبن / ثلاجات / تراخيص" value="${esc(cat?.name||'')}"></div><div class="field full"><label>ملاحظات الفئة</label><textarea name="notes" placeholder="ملاحظات عامة تخص الفئة دي…">${esc(cat?.notes||'')}</textarea></div></div></form>`);
  }
  function itemForm(sectionId,categoryId,it=null){
    const s=getSection(getProject(),sectionId), kind=s?.kind||'generic';
    if(kind==='goods'){
      openModal(it?'تعديل الصنف':'إضافة صنف',`<form id="modalForm" data-form="item" data-section-id="${sectionId}" data-category-id="${categoryId}" data-id="${it?.id||''}"><div class="form-grid">
        <div class="field full"><label>اسم الصنف *</label><input name="name" required maxlength="120" value="${esc(it?.name||'')}"></div>
        <div class="field"><label>الكمية *</label><input name="qty" required min="0" step="any" type="number" value="${it?.qty ?? 1}"></div>
        <div class="field"><label>الوحدة</label><input name="unit" list="units" placeholder="قطعة / كرتونة / كيلو…" value="${esc(it?.unit||'قطعة')}"><datalist id="units"><option>قطعة</option><option>كرتونة</option><option>علبة</option><option>باكت</option><option>كيلو</option><option>جرام</option><option>لتر</option><option>وحدة</option></datalist></div>
        <div class="field"><label>سعر الشراء للوحدة *</label><input name="unitPrice" required min="0" step="any" type="number" value="${it?.unitPrice ?? 0}"></div>
        <div class="field full"><label>المورد / مكان الشراء</label><input name="supplier" maxlength="160" value="${esc(it?.supplier||'')}"></div>
        <div class="field full"><label>ملاحظات</label><textarea name="notes">${esc(it?.notes||'')}</textarea></div>
        <div class="field full"><label>صورة الصنف (اختياري)</label><input name="imageFile" type="file" accept="image/*">${it?.image?`<img class="preview-img" style="display:block" src="${it.image}">`:''}</div>
      </div></form>`);
      return;
    }
    if(kind==='monthly_expenses'){
      openModal(it?'تعديل المصروف':'إضافة مصروف شهري',`<form id="modalForm" data-form="item" data-section-id="${sectionId}" data-category-id="${categoryId}" data-id="${it?.id||''}"><div class="form-grid">
        <div class="field full"><label>اسم البند *</label><input name="name" required maxlength="120" value="${esc(it?.name||'')}"></div>
        <div class="field"><label>العدد / الكمية</label><input name="qty" required min="0" step="any" type="number" value="${it?.qty ?? 1}"></div>
        <div class="field"><label>الوحدة</label><input name="unit" placeholder="موظف / شهر / خدمة…" value="${esc(it?.unit||'شهر')}"></div>
        <div class="field full"><label>القيمة الشهرية للوحدة *</label><input name="unitPrice" required min="0" step="any" type="number" value="${it?.unitPrice ?? 0}"></div>
        <div class="field full"><label>ملاحظات</label><textarea name="notes">${esc(it?.notes||'')}</textarea></div>
      </div></form>`);
      return;
    }
    openModal(it?'تعديل العنصر':'إضافة عنصر',`<form id="modalForm" data-form="item" data-section-id="${sectionId}" data-category-id="${categoryId}" data-id="${it?.id||''}"><div class="form-grid">
      <div class="field full"><label>اسم العنصر *</label><input name="name" required maxlength="120" value="${esc(it?.name||'')}"></div>
      <div class="field"><label>الكمية *</label><input name="qty" required min="0" step="any" type="number" value="${it?.qty ?? 1}"></div>
      <div class="field"><label>الوحدة</label><input name="unit" list="units" placeholder="قطعة / كرتونة / متر…" value="${esc(it?.unit||'قطعة')}"><datalist id="units"><option>قطعة</option><option>كرتونة</option><option>علبة</option><option>باكت</option><option>كيلو</option><option>جرام</option><option>لتر</option><option>متر</option><option>متر مربع</option><option>شهر</option><option>وحدة</option></datalist></div>
      <div class="field"><label>سعر الوحدة *</label><input name="unitPrice" required min="0" step="any" type="number" value="${it?.unitPrice ?? 0}"></div>
      <div class="field"><label>نوع التكلفة</label><select name="period"><option value="startup" ${it?.period!=='monthly'?'selected':''}>مرة واحدة / تأسيس</option><option value="monthly" ${it?.period==='monthly'?'selected':''}>شهري</option></select></div>
      <div class="field"><label>حالة الاختيار</label><select name="status"><option value="confirmed" ${it?.status==='confirmed'||!it?'selected':''}>مؤكد</option><option value="research" ${it?.status==='research'?'selected':''}>قيد المقارنة</option><option value="replace" ${it?.status==='replace'?'selected':''}>محتاج بديل</option></select></div>
      <div class="field full"><label>المورد / مكان الشراء</label><input name="supplier" maxlength="160" value="${esc(it?.supplier||'')}"></div>
      <div class="field full"><label>ملاحظات العنصر</label><textarea name="notes">${esc(it?.notes||'')}</textarea></div>
      <div class="field full"><label>صورة العنصر (اختياري)</label><input name="imageFile" type="file" accept="image/*">${it?.image?`<img class="preview-img" style="display:block" src="${it.image}">`:''}</div>
    </div></form>`);
  }

  async function compressImage(file,max=1200,quality=.82){
    if(!file) return null; if(file.size>12*1024*1024) throw new Error('الصورة كبيرة جدًا');
    const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(file)});
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=data});
    const scale=Math.min(1,max/Math.max(img.width,img.height)); const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',quality);
  }

  function applySearch(q){
    activeSearch=String(q||'').trim().toLowerCase();
    const sections=[...main.querySelectorAll('.section-block')];
    for(const section of sections){
      let sectionHit=!activeSearch || (section.dataset.sectionSearch||'').includes(activeSearch);
      let anyCat=false;
      for(const cat of section.querySelectorAll('.category')){
        const catHit=!activeSearch || (cat.dataset.categorySearch||'').includes(activeSearch);
        let anyItem=false;
        for(const row of cat.querySelectorAll('tr[data-item-search]')){
          const hit=!activeSearch || (row.dataset.itemSearch||'').includes(activeSearch) || catHit || sectionHit;
          row.classList.toggle('hidden-by-search',!hit); if(hit) anyItem=true;
        }
        const show=!activeSearch || catHit || sectionHit || anyItem;
        cat.classList.toggle('hidden-by-search',!show); if(show) anyCat=true;
      }
      section.classList.toggle('hidden-by-search',!!activeSearch && !sectionHit && !anyCat);
    }
  }

  main.addEventListener('input',e=>{ if(e.target.id==='projectSearch') applySearch(e.target.value); });
  modal.addEventListener('input',e=>{ if(e.target.closest('#modalForm[data-form="revenue"]')) updateRevenuePreview(); });
  modal.addEventListener('change',e=>{ if(e.target.closest('#modalForm[data-form="revenue"]')){updateRevenueFormVisibility();updateRevenuePreview();} });
  main.addEventListener('click', async e=>{
    const b=e.target.closest('[data-action]'); if(!b) return; const a=b.dataset.action;
    if(a==='new-project') return projectForm();
    if(a==='open-project'){ currentProjectId=b.dataset.id; activeSearch=''; return render(); }
    if(a==='go-home'){ currentProjectId=null; activeSearch=''; return render(); }
    if(a==='edit-project') return projectForm(getProject());
    if(a==='print-project') return window.print();
    if(a==='new-revenue') return revenueForm();
    if(a==='edit-revenue') return revenueForm(getRevenue(getProject(),b.dataset.revenueId));
    if(a==='delete-revenue'){ const p=getProject(),r=getRevenue(p,b.dataset.revenueId); if(r&&confirm(`حذف مصدر الدخل «${r.name}»؟`)){p.revenues=p.revenues.filter(x=>x.id!==r.id);touchProject(p);await commit('تم حذف مصدر الدخل')} return; }
    if(a==='new-section') return sectionForm();
    if(a==='edit-section') return sectionForm(getSection(getProject(),b.dataset.sectionId));
    if(a==='delete-section'){
      const p=getProject(), s=getSection(p,b.dataset.sectionId); if(confirm(`حذف قسم «${s.name}» بكل الفئات والعناصر؟`)){ p.sections=p.sections.filter(x=>x.id!==s.id); touchProject(p); await commit('تم حذف القسم'); } return;
    }
    if(a==='new-category') return categoryForm(b.dataset.sectionId);
    if(a==='edit-category'){ const s=getSection(getProject(),b.dataset.sectionId); return categoryForm(s.id,getCategory(s,b.dataset.categoryId)); }
    if(a==='delete-category'){
      const p=getProject(),s=getSection(p,b.dataset.sectionId),cat=getCategory(s,b.dataset.categoryId); if(confirm(`حذف فئة «${cat.name}» بكل العناصر؟`)){s.categories=s.categories.filter(x=>x.id!==cat.id);touchProject(p);await commit('تم حذف الفئة')} return;
    }
    if(a==='new-item') return itemForm(b.dataset.sectionId,b.dataset.categoryId);
    if(a==='edit-item'){const s=getSection(getProject(),b.dataset.sectionId),cat=getCategory(s,b.dataset.categoryId);return itemForm(s.id,cat.id,getItem(cat,b.dataset.itemId));}
    if(a==='delete-item'){
      const p=getProject(),s=getSection(p,b.dataset.sectionId),cat=getCategory(s,b.dataset.categoryId),it=getItem(cat,b.dataset.itemId); if(confirm(`حذف «${it.name}»؟`)){cat.items=cat.items.filter(x=>x.id!==it.id);touchProject(p);await commit('تم حذف العنصر')} return;
    }
    if(a==='delete-project'){
      const p=getProject(); if(confirm(`حذف مشروع «${p.name}» نهائيًا؟`)){state.projects=state.projects.filter(x=>x.id!==p.id);currentProjectId=null;await commit('تم حذف المشروع')} return;
    }
    if(a==='add-project-photo'){ document.getElementById('projectPhotoInput')?.click(); return; }
    if(a==='delete-project-photo'){const p=getProject();p.images=(p.images||[]).filter(x=>x.id!==b.dataset.photoId);touchProject(p);await commit('تم حذف الصورة');return;}
  });

  main.addEventListener('change',async e=>{
    if(e.target.id==='projectPhotoInput' && e.target.files?.[0]){
      try{const p=getProject();const data=await compressImage(e.target.files[0]);p.images=p.images||[];p.images.push({id:uid('img'),data});touchProject(p);await commit('تمت إضافة الصورة')}catch(err){alert(err.message||'تعذر حفظ الصورة')}
    }
  });

  modal.addEventListener('click',e=>{ const b=e.target.closest('[data-action="close-modal"]'); if(b) closeModal(); });
  modal.addEventListener('submit', async e=>{
    if(e.target.id!=='modalForm') return; e.preventDefault(); const f=e.target, fd=new FormData(f), type=f.dataset.form;
    try{
      if(type==='project'){
        const id=f.dataset.id; let p=state.projects.find(x=>x.id===id);
        if(!p){p={id:uid('prj'),name:'',description:'',location:'',area:'',currency:'ج',images:[],sections:[{id:uid('sec'),name:'البضاعة',notes:'',kind:'goods',categories:[]},{id:uid('sec'),name:'المصاريف الشهرية',notes:'',kind:'monthly_expenses',categories:[]}],revenues:[],reserveMonths:3,contingencyPct:10,grossMarginPct:0,weakScenarioPct:70,strongScenarioPct:130,createdAt:now(),updatedAt:now()};state.projects.unshift(p);currentProjectId=p.id;}
        p.name=String(fd.get('name')).trim();p.location=String(fd.get('location')).trim();p.area=String(fd.get('area')).trim();p.currency=String(fd.get('currency')).trim()||'ج';p.reserveMonths=clamp(fd.get('reserveMonths'),0,24);p.contingencyPct=clamp(fd.get('contingencyPct'),0,100);p.grossMarginPct=clamp(fd.get('grossMarginPct'),0,100);p.description=String(fd.get('description')).trim();ensureCoreSections(p);touchProject(p);
      }
      if(type==='revenue'){
        const p=getProject();let r=getRevenue(p,f.dataset.id);if(!r){r={id:uid('rev')};p.revenues=p.revenues||[];p.revenues.push(r)}
        r.name=String(fd.get('name')).trim();r.mode=String(fd.get('mode'))==='monthly'?'monthly':'unit';r.quantity=Math.max(0,n(fd.get('quantity')));r.unit=String(fd.get('unit')).trim()||'عملية';r.frequency=String(fd.get('frequency'))==='daily'?'daily':'monthly';r.workDays=clamp(fd.get('workDays')||26,0,31);r.salePrice=Math.max(0,n(fd.get('salePrice')));r.unitCost=Math.max(0,n(fd.get('unitCost')));r.monthlyRevenue=Math.max(0,n(fd.get('monthlyRevenue')));r.monthlyDirectCost=Math.max(0,n(fd.get('monthlyDirectCost')));r.notes=String(fd.get('notes')).trim();r.updatedAt=now();touchProject(p);
      }
      if(type==='section'){
        const p=getProject();let s=getSection(p,f.dataset.id);if(!s){s={id:uid('sec'),name:'',notes:'',categories:[]};p.sections.push(s)}s.name=String(fd.get('name')).trim();s.notes=String(fd.get('notes')).trim();touchProject(p);
      }
      if(type==='category'){
        const p=getProject(),s=getSection(p,f.dataset.sectionId);let cat=getCategory(s,f.dataset.id);if(!cat){cat={id:uid('cat'),name:'',notes:'',items:[]};s.categories.push(cat)}cat.name=String(fd.get('name')).trim();cat.notes=String(fd.get('notes')).trim();touchProject(p);
      }
      if(type==='item'){
        const p=getProject(),s=getSection(p,f.dataset.sectionId),cat=getCategory(s,f.dataset.categoryId);let it=getItem(cat,f.dataset.id);if(!it){it={id:uid('item'),image:null};cat.items.push(it)}
        it.name=String(fd.get('name')).trim();it.qty=Math.max(0,n(fd.get('qty')));it.unit=String(fd.get('unit')).trim();it.unitPrice=Math.max(0,n(fd.get('unitPrice')));if(s.kind==='goods'){if(fd.has('salePrice')) it.salePrice=Math.max(0,n(fd.get('salePrice')));it.period='startup';}else if(s.kind==='monthly_expenses'){it.period='monthly';}else{it.period=String(fd.get('period')||it.period||'startup');}it.status=String(fd.get('status')||it.status||'confirmed');it.supplier=String(fd.get('supplier')||it.supplier||'').trim();it.notes=String(fd.get('notes')||'').trim();it.updatedAt=now();const file=f.querySelector('[name="imageFile"]')?.files?.[0];if(file) it.image=await compressImage(file,900,.8);touchProject(p);
      }
      closeModal(); await commit('تم الحفظ');
    }catch(err){console.error(err);alert(err.message||'حصل خطأ أثناء الحفظ')}
  });

  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]'); if(!b) return;
    if(b.dataset.action==='export-backup') exportBackup();
    if(b.dataset.action==='import-backup') backupFile.click();
  });

  async function exportBackup(){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`feasibility-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('تم تجهيز النسخة الاحتياطية');
  }
  backupFile.addEventListener('change',async()=>{
    const file=backupFile.files?.[0];if(!file)return;try{const parsed=JSON.parse(await file.text());if(!parsed||!Array.isArray(parsed.projects)) throw new Error('ملف غير صالح');if(!confirm('استرجاع النسخة سيستبدل البيانات الحالية على الجهاز. متابعة؟'))return;state=normalizeState(parsed);currentProjectId=null;await commit('تم استرجاع النسخة')}catch(err){alert('تعذر استرجاع الملف: '+(err.message||''))}finally{backupFile.value=''}
  });

  window.__feasibilityTest = { calcItems, calcCategory, calcSection, calcProject, calcGoods, calcBreakEven, calcRevenueSource, calcRevenues, calcScenario, normalizeState, state:()=>state };

  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
  load().catch(err=>{console.error(err);main.innerHTML='<div class="card empty"><strong>تعذر فتح البيانات</strong>جرّب إعادة تحميل الصفحة.</div>'});
})();
