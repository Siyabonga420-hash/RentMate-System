const $=id=>document.getElementById(id);const money=n=>'R '+Number(n||0).toLocaleString('en-ZA',{minimumFractionDigits:2});let token=sessionStorage.getItem('rentmate_admin_token');
async function api(path,method='GET',data){const r=await fetch(path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.detail||'Request failed');return j}
function row(id,values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v??'—';tr.append(td)}$(id).append(tr)}function empty(id,n){if(!$(id).children.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=n;td.textContent='No records';tr.append(td);$(id).append(tr)}}
async function refresh(){try{$('message').textContent='Loading…';const {managers,properties,tenants,units,rents,payments}=await api('/admin/overview');const due=rents.reduce((a,r)=>a+Number(r.amount_due),0),paid=payments.reduce((a,p)=>a+Number(p.amount),0);$('metrics').replaceChildren();for(const [label,value] of [['Managers',managers.length],['Properties',properties.length],['Units',units.length],['Tenants',tenants.length],['Outstanding',money(due-paid)]]){const d=document.createElement('div');d.className='metric';const b=document.createElement('b');b.textContent=value;const s=document.createElement('span');s.textContent=label;d.append(b,s);$('metrics').append(d)}for(const id of ['managers','properties','tenants','rentBody'])$(id).replaceChildren();managers.forEach(m=>row('managers',[m.business_name,m.status,String(m.created_at).slice(0,10)]));properties.forEach(p=>row('properties',[p.property_name,p.address,managers.find(m=>m.id===p.manager_id)?.business_name||p.manager_id]));tenants.forEach(t=>row('tenants',[t.full_name,t.email,t.status]));rents.forEach(r=>{const sum=payments.filter(p=>p.rent_id===r.id).reduce((a,p)=>a+Number(p.amount),0);row('rentBody',[tenants.find(t=>t.id===r.tenant_id)?.full_name||r.tenant_id,String(r.due_date).slice(0,10),money(r.amount_due),money(sum),money(Number(r.amount_due)-sum),r.status])});for(const [id,n] of [['managers',3],['properties',3],['tenants',3],['rentBody',6]])empty(id,n);$('message').textContent='Data refreshed.'}catch(e){$('message').textContent=e.message}}
async function init(){if(!token){$('loginPanel').hidden=false;$('app').hidden=true;$('logout').hidden=true;return}try{const me=await api('/me');if(me.role!=='admin')throw Error('Administrator role required');$('who').textContent=me.full_name;$('loginPanel').hidden=true;$('app').hidden=false;$('logout').hidden=false;await refresh()}catch(e){$('loginMessage').textContent=e.message;token=null;sessionStorage.removeItem('rentmate_admin_token');$('app').hidden=true;$('loginPanel').hidden=false;$('logout').hidden=true}}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const result=await api('/auth/login','POST',{email:$('email').value.trim(),password:$('password').value});token=result.access_token;sessionStorage.setItem('rentmate_admin_token',token);await init()}catch(x){$('loginMessage').textContent=x.message}};$('logout').onclick=()=>{token=null;sessionStorage.removeItem('rentmate_admin_token');window.location.replace('/portal/')};$('refresh').onclick=refresh;init();


/* RENTMATE ADMIN MANAGER REGISTRATION */

const createManagerForm = document.getElementById('createManagerForm');

if (createManagerForm) {
    createManagerForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const button = document.getElementById('createManagerButton');
        const message = document.getElementById('managerCreationMessage');

        const payload = {
            full_name: document.getElementById('managerFullName').value.trim(),
            business_name: document.getElementById('managerBusinessName').value.trim(),
            email: document.getElementById('managerEmail').value.trim().toLowerCase(),
            password: document.getElementById('managerPassword').value
        };

        if (!payload.full_name || !payload.business_name || !payload.email) {
            message.textContent = 'Please complete all required fields.';
            return;
        }

        if (payload.password.length < 8) {
            message.textContent = 'Password must contain at least 8 characters.';
            return;
        }

        button.disabled = true;
        button.textContent = 'Creating account...';
        message.textContent = 'Creating manager account...';

        try {
            await api('/admin/managers', 'POST', payload);

            createManagerForm.reset();

            message.textContent = 'Manager account created successfully.';

            await refresh();

        } catch (error) {
            message.textContent = 'Unable to create manager: ' + error.message;
        } finally {
            button.disabled = false;
            button.textContent = 'Create Manager Account';
        }
    });
}