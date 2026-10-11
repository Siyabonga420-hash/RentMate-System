const $=id=>document.getElementById(id);const money=n=>'R '+Number(n||0).toLocaleString('en-ZA',{minimumFractionDigits:2});const notify=(m,b=false)=>{$('message').textContent=m;$('message').className=b?'error':'ok'};
let token=sessionStorage.getItem('rentmate_manager_token'),portfolio={};
async function api(path,method='GET',data){const r=await fetch(path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.detail||'Request failed');return j}
function row(id,values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v??'â€”';tr.append(td)}$(id).append(tr)}
function empty(id,n){if(!$(id).children.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=n;td.textContent='No records';tr.append(td);$(id).append(tr)}}
function option(id,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;$(id).append(o)}
function tabs(){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-panel]').forEach(x=>x.hidden=x.dataset.panel!==b.dataset.tab)})}
async function init(){if(!token){$('app').hidden=true;$('loginPanel').hidden=false;$('logout').hidden=true;return}try{const me=await api('/me');if(me.role!=='manager')throw Error('Manager role required');$('who').textContent=me.full_name;$('app').hidden=false;$('loginPanel').hidden=true;$('logout').hidden=false;await refresh();if(window.RentMateRecurringSettings){await window.RentMateRecurringSettings.load()}if(window.RentMateRecurringPreview){await window.RentMateRecurringPreview.load()}}catch(e){sessionStorage.removeItem('rentmate_manager_token');token=null;$('loginMessage').textContent=e.message;$('app').hidden=true;$('loginPanel').hidden=false;$('logout').hidden=true}}
async function refresh(){try{notify('Loading portfolioâ€¦');portfolio=await api('/manager/portfolio');const {properties,units,tenants,rents,payments}=portfolio;const tName=id=>tenants.find(t=>t.id===id)?.full_name||id;const paid=id=>payments.filter(p=>p.rent_id===id&&String(p.payment_method||"").toLowerCase()!=="demo").reduce((a,p)=>a+Number(p.amount),0);$('metrics').replaceChildren();for(const [label,val] of [['Properties',properties.length],['Units',units.length],['Tenants',tenants.length],['Outstanding',money(rents.reduce((a,r)=>a+Math.max(0,Number(r.amount_due)-paid(r.id)),0))]]){const d=document.createElement('div');d.className='metric';const b=document.createElement('b');b.textContent=val;const s=document.createElement('span');s.textContent=label;d.append(b,s);$('metrics').append(d)}$('snapshot').textContent=`${properties.length} properties, ${tenants.length} tenants, ${rents.length} charges, ${payments.length} payments.`;for(const id of ['overviewRent','propertiesBody','tenantsBody','rentBody','paymentsBody','propertySelect','rentTenant','paymentRent'])$(id).replaceChildren();properties.forEach(p=>option('propertySelect',p.id,p.property_name));tenants.forEach(t=>option('rentTenant',t.id,t.full_name));properties.forEach(p=>{const us=units.filter(u=>u.property_id===p.id);(us.length?us:[null]).forEach(u=>row('propertiesBody',[p.property_name,p.address,u?.unit_number,u?money(u.monthly_rent):'â€”',u?.status]))});tenants.forEach(t=>row('tenantsBody',[t.full_name,t.email,t.status,t.household_id]));rents.forEach(r=>{const total=paid(r.id);row('rentBody',[tName(r.tenant_id),String(r.due_date).slice(0,10),money(r.amount_due),money(total),money(Number(r.amount_due)-total),(total>=Number(r.amount_due)?"paid":total>0?"partial":"unpaid")]);option('paymentRent',r.id,`${tName(r.tenant_id)} Â· ${String(r.due_date).slice(0,10)}`)});rents.slice(0,8).forEach(r=>row('overviewRent',[tName(r.tenant_id),String(r.due_date).slice(0,10),money(r.amount_due),(paid(r.id)>=Number(r.amount_due)?"paid":paid(r.id)>0?"partial":"unpaid")]));payments.forEach(p=>{const demo=String(p.payment_method||"").toLowerCase()==="demo";row('paymentsBody',[tName(p.tenant_id),String(p.payment_date).slice(0,10),money(p.amount),demo?"DEMO - SIMULATED":p.payment_method,p.reference])});for(const [id,n] of [['overviewRent',4],['propertiesBody',5],['tenantsBody',4],['rentBody',6],['paymentsBody',5]])empty(id,n);notify('Portfolio updated.')}catch(e){notify(e.message,true)}}
async function submit(endpoint,payload,form){
    const button = form.querySelector('button[type="submit"],button:not([type])');

    const operation = async () => {
        await api(endpoint,'POST',payload);
        form.reset();
        await refresh();
        notify('Saved successfully');
    };

    if (window.RentMateLoading) {
        return window.RentMateLoading.run(button, operation);
    }

    return operation();
}
$('loginForm').onsubmit=async e=>{
    e.preventDefault();

    const button=e.target.querySelector('button[type="submit"],button:not([type])');

    const operation=async()=>{
        try{
            const result=await api('/auth/login','POST',{
                email:$('email').value.trim(),
                password:$('password').value
            });

            token=result.access_token;
            sessionStorage.setItem('rentmate_manager_token',token);
            await init();
        }catch(x){
            $('loginMessage').textContent=x.message;
        }
    };

    if(window.RentMateLoading){
        await window.RentMateLoading.run(button,operation);
    }else{
        await operation();
    }
};
$('logout').onclick=()=>{token=null;sessionStorage.removeItem('rentmate_manager_token');window.location.replace('/portal/')};$('refresh').onclick=refresh;
$('propertyForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await submit('/manager/properties',{property_name:f.get('property_name'),address:f.get('address'),total_units:Number(f.get('total_units'))},e.target)}catch(x){notify(x.message,true)}};
$('unitForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await submit('/manager/units',{property_id:f.get('property_id'),unit_number:f.get('unit_number'),monthly_rent:Number(f.get('monthly_rent')),status:f.get('status')},e.target)}catch(x){notify(x.message,true)}};
$('rentForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await submit('/manager/rent',{tenant_id:f.get('tenant_id'),amount_due:Number(f.get('amount_due')),due_date:f.get('due_date')},e.target)}catch(x){notify(x.message,true)}};
$('paymentForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);if(!confirm('Record this manually verified payment?'))return;try{await submit('/manager/payments',{rent_id:f.get('rent_id'),amount:Number(f.get('amount')),payment_method:f.get('payment_method'),reference:f.get('reference')},e.target)}catch(x){notify(x.message,true)}};
tabs();
init();

document.querySelectorAll('[data-tab="households"]').forEach(button => {
    button.addEventListener('click', () => {
        if (token) {
            extraRefresh();
        }
    });
});

// Additional manager tools rendered below existing dashboard; uses the same API session.
const el=document.createElement('section');el.style.cssText='padding:24px;max-width:1100px;margin:auto';el.innerHTML=`<h2>Tenant assignment & household operations</h2><p id="extraStatus"></p><div style="display:flex;gap:10px;flex-wrap:wrap"><select id="pendingTenants"></select><select id="assignUnits"></select><button id="assignButton">Assign tenant to unit</button></div><hr><form id="choreForm"><h3>Create chore</h3><select name="household_id" id="choreHousehold" required></select><input name="title" placeholder="Chore title" required><input name="due_date" type="date"><button>Create chore</button></form><form id="announcementForm"><h3>Post announcement</h3><select name="household_id" id="announcementHousehold"><option value="">All my households</option></select><input name="title" placeholder="Title" required><input name="body" placeholder="Message" required><button>Post</button></form>`;const householdContainer = document.getElementById('householdTools');

if (householdContainer) {
    householdContainer.append(el);
} else {
    document.body.append(el);
}
async function extraRefresh(){if(!token)return;try{const [pending,p]=await Promise.all([api('/manager/unassigned-tenants'),api('/manager/portfolio')]);for(const id of ['pendingTenants','assignUnits','choreHousehold','announcementHousehold'])document.getElementById(id).replaceChildren();for(const t of pending){const o=new Option(`${t.full_name} (${t.email})`,t.id);document.getElementById('pendingTenants').add(o)}for(const u of p.units){document.getElementById('assignUnits').add(new Option(u.unit_number,u.id));const h=await api('/manager/household-for-unit/'+u.id);for(const id of ['choreHousehold','announcementHousehold'])document.getElementById(id).add(new Option(u.unit_number,h.id))}document.getElementById('announcementHousehold').add(new Option('All my households',''),0)}catch(e){document.getElementById('extraStatus').textContent=e.message}}
document.getElementById('assignButton').onclick=async()=>{
    const button=document.getElementById('assignButton');

    const operation=async()=>{
        try{
            await api('/manager/assign-tenant','POST',{
                tenant_id:document.getElementById('pendingTenants').value,
                unit_id:document.getElementById('assignUnits').value
            });

            await refresh();
            await extraRefresh();
        }catch(e){
            document.getElementById('extraStatus').textContent=e.message;
        }
    };

    if(window.RentMateLoading){
        await window.RentMateLoading.run(button,operation);
    }else{
        await operation();
    }
};
for(const [form,url] of [
    ['choreForm','/manager/chores'],
    ['announcementForm','/manager/announcements']
]){
    document.getElementById(form).onsubmit=async e=>{
        e.preventDefault();

        const button=e.target.querySelector('button[type="submit"],button:not([type])');
        const f=new FormData(e.target);
        const data=Object.fromEntries(f);

        if(!data.household_id)delete data.household_id;
        if(!data.due_date)delete data.due_date;

        const operation=async()=>{
            try{
                await api(url,'POST',data);
                e.target.reset();
                document.getElementById('extraStatus').textContent='Saved';
            }catch(x){
                document.getElementById('extraStatus').textContent=x.message;
            }
        };

        if(window.RentMateLoading){
            await window.RentMateLoading.run(button,operation);
        }else{
            await operation();
        }
    };
}
setInterval(()=>{if(token&&document.getElementById('app')&&!document.getElementById('app').hidden)extraRefresh()},20000);


/* RENTMATE BULK RENT BILLING PREVIEW */

(() => {

    const $ = id => document.getElementById(id);

    const form = $('bulkRentForm');
    const amountInput = $('bulkRentAmount');
    const dateInput = $('bulkRentDate');
    const preview = $('bulkRentPreview');

    if (!form || !amountInput || !dateInput || !preview) return;

    const today = () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');

        return `${y}-${m}-${d}`;
    };

    const monthEnd = () => {
        const now = new Date();

        const end = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0
        );

        const y = end.getFullYear();
        const m = String(end.getMonth() + 1).padStart(2, '0');
        const d = String(end.getDate()).padStart(2, '0');

        return `${y}-${m}-${d}`;
    };

    const individualDate = document.querySelector(
        '#rentForm input[name="due_date"]'
    );

    if (individualDate) {
        individualDate.min = today();

        individualDate.addEventListener('focus', () => {
            individualDate.min = today();
        });
    }

    dateInput.min = today();
    dateInput.value = monthEnd();

    const confirmButton = document.createElement('button');

    confirmButton.type = 'button';
    confirmButton.id = 'confirmBulkRent';
    confirmButton.textContent = 'Confirm & Create Charges';
    confirmButton.hidden = true;

    preview.after(confirmButton);

    let approvedPreview = null;

    const resetPreview = () => {
        approvedPreview = null;
        confirmButton.hidden = true;
        preview.textContent = '';
    };

    amountInput.addEventListener('input', resetPreview);
    dateInput.addEventListener('input', resetPreview);

    $('bulkMonthEnd').onclick = () => {
        dateInput.value = monthEnd();
        resetPreview();
    };

    form.addEventListener('submit', event => {
        event.preventDefault();

        resetPreview();

        const amount = Number(amountInput.value);
        const dueDate = dateInput.value;

        if (
            !Number.isFinite(amount) ||
            amount <= 0 ||
            Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001
        ) {
            preview.textContent = 'Enter a valid rent amount.';
            return;
        }

        if (!dueDate || dueDate < today()) {
            preview.textContent = 'Due date cannot be in the past.';
            return;
        }

        const tenants = Array.isArray(portfolio?.tenants)
            ? portfolio.tenants.filter(
                tenant => tenant.status === 'active'
            )
            : [];

        if (!tenants.length) {
            preview.textContent = 'No active tenants available.';
            return;
        }

        approvedPreview = {
            amount_due: amount,
            due_date: dueDate
        };

        const total = tenants.length * amount;

        preview.textContent =
            `${tenants.length} active tenants Ã— R${amount.toFixed(2)} ` +
            `= R${total.toFixed(2)}. Due: ${dueDate}. ` +
            'Review this information before confirming.';

        confirmButton.hidden = false;
    });

    confirmButton.addEventListener('click', async () => {

        if (!approvedPreview || confirmButton.disabled) return;

        const payload = { ...approvedPreview };

        if (
            Number(amountInput.value) !== payload.amount_due ||
            dateInput.value !== payload.due_date
        ) {
            resetPreview();
            return;
        }

        if (!confirm(
            `Create rent charges for all active tenants?\n\n` +
            `Amount per tenant: R${payload.amount_due.toFixed(2)}\n` +
            `Due date: ${payload.due_date}`
        )) {
            return;
        }

        confirmButton.disabled = true;
        confirmButton.textContent = 'Creating charges...';

        try {

            const result = await api(
                '/manager/rent/bulk',
                'POST',
                payload
            );

            approvedPreview = null;
            confirmButton.hidden = true;

            const successMessage =
                `Completed: ${result.created} charges created, ` +
                `${result.skipped} skipped. ` +
                `Total newly charged: R${Number(
                    result.total_charged || 0
                ).toFixed(2)}.`;

            preview.textContent = successMessage;

            try {
                await refresh();
                preview.textContent = successMessage;
            } catch (refreshError) {
                preview.textContent =
                    successMessage +
                    ' The dashboard could not refresh automatically. ' +
                    'Please refresh the page to see the latest balances.';
            }

        } catch (error) {

            preview.textContent =
                'Unable to create charges: ' + error.message;

        } finally {

            confirmButton.disabled = false;
            confirmButton.textContent =
                'Confirm & Create Charges';

        }
    });

})();

// RENTMATE RECURRING BILLING FORM
(() => {
    const form = document.getElementById('recurringRentForm');
    const amount = document.getElementById('recurringRentAmount');
    const schedule = document.getElementById('recurringRentSchedule');
    const day = document.getElementById('recurringRentDay');
    const dayWrapper = document.getElementById('recurringRentDayWrapper');
    const enabled = document.getElementById('recurringRentEnabled');
    const message = document.getElementById('recurringRentMessage');

    if (!form) return;

    function updateDayVisibility() {
        const specific = schedule.value === 'specific-day';
        dayWrapper.hidden = !specific;
        day.disabled = !specific;
    }

    function showMessage(text, error = false) {
        message.textContent = text;
        message.className = error ? 'error' : 'ok';
    }

    async function loadSettings() {
        if (!token) return;

        try {
            const result = await api(
                '/manager/rent/recurring-settings'
            );

            const settings = result.settings;

            amount.value = settings.amount_due;
            schedule.value = settings.use_month_end
                ? 'month-end'
                : 'specific-day';

            day.value = settings.due_day;
            enabled.checked = settings.enabled === true;
            enabled.disabled = false;

            updateDayVisibility();

            showMessage(
                result.configured
                    ? 'Current billing settings loaded.'
                    : 'Default settings loaded. Automatic billing is disabled.'
            );

        } catch (error) {
            showMessage(
                'Could not load billing settings: ' + error.message,
                true
            );
        }
    }

    schedule.addEventListener('change', updateDayVisibility);

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (!token) {
            showMessage('Please sign in first.', true);
            return;
        }

        const payload = {
            amount_due: Number(amount.value),
            due_day: Number(day.value),
            use_month_end: schedule.value === 'month-end',
            enabled: enabled.checked
        };

        const button = form.querySelector('button[type="submit"]');

        const save = async () => {
            const result = await api(
                '/manager/rent/recurring-settings',
                'PUT',
                payload
            );

            showMessage(result.message);

            if (window.RentMateRecurringPreview) {
                await window.RentMateRecurringPreview.load();
            }
        };

        try {
            if (window.RentMateLoading) {
                await window.RentMateLoading.run(button, save);
            } else {
                await save();
            }
        } catch (error) {
            showMessage(error.message, true);
        }
    });

    updateDayVisibility();

    // Settings are loaded after the dashboard finishes authentication.
    window.RentMateRecurringSettings = {
        load: loadSettings
    };
})();
// END RENTMATE RECURRING BILLING FORM

// RENTMATE RECURRING BILLING PREVIEW CARD
(() => {
    const element = id => document.getElementById(id);

    const money = value =>
        new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: 'ZAR'
        }).format(Number(value) || 0);

    async function loadPreview() {
        const message = element('recurringPreviewMessage');

        if (!message) return;

        message.textContent = 'Loading billing preview...';

        try {
            const data = await api('/manager/rent/recurring-preview');

            element('previewRentAmount').textContent =
                money(data.amountDue);

            element('previewBillingDate').textContent =
                data.dueDate || '--';

            element('previewActiveTenants').textContent =
                String(data.activeTenants ?? 0);

            element('previewEstimatedTotal').textContent =
                money(data.estimatedTotal);

            element('previewBillingStatus').textContent =
                data.enabled ? 'Enabled' : 'Disabled';

            element('previewEligibility').textContent =
                data.eligible
                    ? 'Billing date reached'
                    : 'Upcoming';

            message.textContent = data.message || 'Preview updated.';
        } catch (error) {
            message.textContent =
                'Could not load billing preview: ' + error.message;
        }
    }

    const button = element('refreshRecurringPreview');

    if (button) {
        button.addEventListener('click', async () => {
            if (window.RentMateLoading?.run) {
                await window.RentMateLoading.run(
                    button,
                    loadPreview
                );
            } else {
                await loadPreview();
            }
        });
    }

    window.RentMateRecurringPreview = {
        load: loadPreview
    };
})();
