// Category identity is independent of funding, transaction direction, list order and theme.
const palette=['#a78bfa','#60a5fa','#f472b6','#2dd4bf','#fbbf24','#fb923c','#c084fc','#38bdf8'];
function luminance(hex:string){const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;}
export function categoryIdentity(id:number|null|undefined,color?:string|null):{fill:string;ink:string}{
 let fill=Number.isSafeInteger(id)&&id!=null?palette[((id%palette.length)+palette.length)%palette.length]:'#a1a1aa';
 if(color&&/^#[\da-f]{6}$/i.test(color))fill=color.toLowerCase();
 else if(color&&/^#[\da-f]{3}$/i.test(color))fill='#'+color.slice(1).split('').map(v=>v+v).join('').toLowerCase();
 const l=luminance(fill),dark='#000000',light='#ffffff';
 const contrast=(other:string)=>(Math.max(l,luminance(other))+0.05)/(Math.min(l,luminance(other))+0.05);
 return {fill,ink:contrast(dark)>=contrast(light)?dark:light};
}
