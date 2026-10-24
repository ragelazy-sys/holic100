// A delivered game cannot be made secret retroactively. Stop an open document when its session/network is lost.
let checking=false;
async function check(){
 if(checking)return;checking=true;
 try{const response=await fetch('/auth/session',{cache:'no-store',credentials:'same-origin'});if(response.status!==204)location.replace('/login');}
 catch{location.replace('/login');}finally{checking=false;}
}
window.addEventListener('offline',()=>location.replace('/login'));
window.addEventListener('pageshow',check);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
setInterval(check,30000);
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});}
