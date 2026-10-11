'use strict';
const $ = (selector) => document.querySelector(selector);
const el = (tag, className, value) => {const node = document.createElement(tag); if(className) node.className = className; if(value !== undefined) node.textContent = value; return node;};
let portfolio, category = 'All', visible = 6;
const prettyDate = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'}) : '';
function openDialog(dialog) {dialog.showModal(); document.body.classList.add('no-scroll');}
document.querySelectorAll('dialog').forEach(dialog => {
 dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
 dialog.addEventListener('close', () => document.body.classList.remove('no-scroll'));
 dialog.addEventListener('click', event => {const r=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))dialog.close();});
});
function renderProjects() {
 const items=portfolio.projects.filter(project=>category==='All'||project.category===category);
 $('#projects').replaceChildren();
 items.slice(0,visible).forEach(project=>{
  const card=el('button','project-card');card.type='button';card.setAttribute('aria-label','View '+project.title);
  const photo=el('div','project-image'),img=el('img');img.src=project.image;img.alt=project.title;img.loading='lazy';photo.append(img,el('span','project-open','↗'));
  card.append(photo,el('p','eyebrow',project.category),el('h3','',project.title));
  card.addEventListener('click',()=>{$('#gallery-image').src=project.image;$('#gallery-image').alt=project.title;$('#gallery-category').textContent=project.category;$('#gallery-title').textContent=project.title;$('#gallery-description').textContent=project.description;openDialog($('#project-dialog'));});$('#projects').append(card);
 });
 $('#project-count').textContent=`${items.length} ${items.length===1?'creation':'creations'}`;$('#show-more').hidden=items.length<=visible;
 if(!items.length)$('#projects').append(el('p','quiet','New creations are on their way. Check back soon.'));
}
function render(data) {
 portfolio={...data,projects:[...data.projects].sort((a,b)=>Number(b.featured)-Number(a.featured))};const p=data.profile;document.title=`${p.name} — Chef & Pastry Portfolio`;
 document.querySelectorAll('[data-name]').forEach(node=>node.textContent=p.name);
 $('#hero-role').textContent=p.role;$('#portrait-role').textContent=p.role;$('#hero-tagline').textContent=p.tagline;
 $('#portrait').src=p.portrait;$('#portrait').alt=`Chef ${p.name}`;
 $('#availability').textContent=p.availability;$('#hero-location').textContent=p.location;$('#contact-location').textContent=p.location;$('#introduction').textContent=p.introduction;
 $('#resume-link').hidden=!p.resume;if(p.resume)$('#resume-link').href=p.resume;
 $('#contact-email').textContent=p.email+' ↗';$('#contact-email').href='mailto:'+p.email;$('#contact-email').hidden=!p.email;
 $('#contact-phone').textContent=p.phone;$('#contact-phone').href='tel:'+p.phone.replace(/[^+\d]/g,'');$('#contact-phone').hidden=!p.phone;
 $('#specialties').replaceChildren(...data.specialties.map(item=>el('span','',item)));
 $('#specialty-strip').replaceChildren();data.specialties.slice(0,4).forEach((item,i)=>{if(i)$('#specialty-strip').append(el('span','','✦'));$('#specialty-strip').append(el('span','',item));});
 $('#experience').replaceChildren();data.experience.forEach(item=>{const node=el('div','timeline-item');node.append(el('h4','',item.role),el('span','quiet',`${item.workplace} · ${item.period}`),el('p','',item.description));$('#experience').append(node);});
 $('#social-links').replaceChildren();Object.entries(p.socials).forEach(([key,url])=>{if(!url)return;const a=el('a','',key==='linkedin'?'LinkedIn ↗':key.charAt(0).toUpperCase()+key.slice(1)+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';$('#social-links').append(a);});
 if(category!=='All'&&!data.projects.some(item=>item.category===category))category='All';
 const filters=$('#project-filters');filters.replaceChildren();['All',...new Set(data.projects.map(item=>item.category))].forEach(value=>{const button=el('button','filter'+(value===category?' active':''),value==='All'?'All creations':value);button.type='button';button.setAttribute('aria-pressed',String(value===category));button.addEventListener('click',()=>{category=value;visible=6;filters.querySelectorAll('button').forEach(node=>{node.classList.toggle('active',node===button);node.setAttribute('aria-pressed',String(node===button));});renderProjects();});filters.append(button);});renderProjects();
 $('#thought-list').replaceChildren();data.thoughts.forEach((item,index)=>{const card=el('button','thought-card');card.type='button';card.append(el('span','eyebrow',prettyDate(item.date)||'KITCHEN NOTE '+String(index+1).padStart(2,'0')),el('h3','',item.title),el('p','',item.body.length>150?item.body.slice(0,150)+'…':item.body),el('span','text-link','Read the note ↗'));card.addEventListener('click',()=>{$('#reading-date').textContent=prettyDate(item.date)||'FROM THE KITCHEN';$('#reading-title').textContent=item.title;$('#reading-body').textContent=item.body;openDialog($('#thought-dialog'));});$('#thought-list').append(card);});
 if(!data.thoughts.length){const empty=el('div','empty-note'),copy=el('div');copy.append(el('h3','','Fresh thoughts are on their way.'),el('p','','I’ll share new ideas, little lessons, and moments from the kitchen here.'));empty.append(el('span','','✦'),copy);$('#thought-list').append(empty);}
 $('#review-list').replaceChildren();data.reviews.forEach(item=>{const card=el('blockquote','review-card');if(item.rating){const stars=el('div','stars','★'.repeat(item.rating)+'☆'.repeat(5-item.rating));stars.setAttribute('aria-label',`${item.rating} out of 5 stars`);card.append(stars);}const footer=el('footer');footer.append(el('cite','',item.name),el('span','quiet',item.context));card.append(el('p','review-quote','“'+item.quote+'”'),footer);$('#review-list').append(card);});if(!data.reviews.length)$('#review-list').append(el('p','quiet','Customer feedback will appear here soon.'));
}
$('#year').textContent=new Date().getFullYear();$('#show-more').addEventListener('click',()=>{visible+=6;renderProjects();});
$('#share-link').addEventListener('click',async()=>{const url=new URL('/',location.href).href;try{await navigator.clipboard.writeText(url);$('#share-status').textContent='Portfolio link copied.';}catch{$('#share-status').textContent=url;}});
async function loadPortfolio(){try{const response=await fetch('/api/portfolio',{cache:'no-store'});if(!response.ok)throw new Error();render(await response.json());$('#load-error').hidden=true;}catch{$('#load-error').hidden=false;}}
loadPortfolio();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadPortfolio();});
