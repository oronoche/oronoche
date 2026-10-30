/* bloqueo de zoom (pellizco, doble toque, gestos iOS) */
['gesturestart','gesturechange','gestureend'].forEach(e=>document.addEventListener(e,ev=>ev.preventDefault(),{passive:false}));
document.addEventListener('touchmove',ev=>{if(ev.touches.length>1)ev.preventDefault();else if(ev.target.closest&&ev.target.closest('#sdWrap')&&!ev.target.closest('.sd-info'))ev.preventDefault()},{passive:false});
let _lt=0;document.addEventListener('touchend',ev=>{const n=Date.now();if(n-_lt<350&&ev.target.closest&&!ev.target.closest('input,select,textarea'))ev.preventDefault();_lt=n},{passive:false});
document.addEventListener('wheel',ev=>{if(ev.ctrlKey)ev.preventDefault()},{passive:false});
document.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&['+','-','=','0'].includes(ev.key))ev.preventDefault()});
