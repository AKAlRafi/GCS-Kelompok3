// visualisasi orientasi wahana dalam horizon buatan

//useref = acces canvas
import {useRef, useEffect} from 'react';

const DEG = Math.PI / 180; // radian untuk attitude

//for horizon gambar langit tanah skala gambar pesawat
function drawAttitude(ctx, size, roll, pitch) {
    const c = size /2;
    const r= size/2 - 4;
    const pxPerDeg = r/30;

    ctx.clearRect(0,0, size, size);

    // bagian yang bergerak
    ctx.save();
    ctx.translate(c, c);

    ctx.beginPath();
    ctx.arc(0,0,r,0,Math.PI*2);
    ctx.clip();

    //roll atas bawah 
    ctx.rotate(-roll * DEG); //memutar ui berdasarkan nilai roll

    //pitch kanan kiri 
    ctx.save();
    ctx.translate(0, pitch * pxPerDeg); //geser ui by nilai pitch

    // Permukaan bumi dan langit memakai warna instrumen yang senada dengan tema.
    ctx.fillStyle = '#334155';
    ctx.fillRect(-2 * r, 0, 4 * r, 4 * r);


    ctx.fillStyle = '#0369a1';
    ctx.fillRect(-2*r, -4*r, 4*r, 4*r);

    //horizon line batas langit tanah
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(-2*r, 0);
    ctx.lineTo(2*r, 0);
    ctx.stroke();

    //skala pitch atau sudut kemiringan 
    [-20, -10, 10, 20].forEach((deg) => {
        const y = -deg * pxPerDeg;
        const half = deg %20 === 0 ? r *0.3 : r*0.18;

        ctx.beginPath();
        ctx.moveTo(-half, y);
        ctx.lineTo(half, y);
        ctx.stroke();

        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.abs(deg)), half + 14, y);
    });

    ctx.restore();

    //skala roll
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;

    [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]
     .forEach((angle) => {
        const len = angle % 30 === 0 ? 14 : 8;

        ctx.save();
        ctx.rotate(angle*DEG);

        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(0, -r + len);
        ctx.stroke();

        ctx.restore();
     });
    ctx.restore();

    //instrumen frame
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(c, c -r +16);
    ctx.lineTo(c-7, c-r+30);
    ctx.lineTo(c+7, c-r+30);
    ctx.closePath();
    ctx.fill();

    //pesawat middle
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(c -r *0.6, c);
    ctx.lineTo(c-r*0.2, c);
    ctx.lineTo(c-r*0.2, c+10);

    ctx.beginPath();
    ctx.moveTo(c+r *0.6, c);
    ctx.lineTo(c+r*0.2, c);
    ctx.lineTo(c+r*0.2, c+10);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(c, c, 4, 0, Math.PI*2);
    ctx.fill();
}

export default function AttitudeIndicator({ //terima nilai dari 3 komponen
    roll = 0, //miring
    pitch = 0, //mendongak nunduk
    size = 220, //ukuran 
}) {
    const canvasRef = useRef(null); //elemen html for drawing with js 

    const safeRoll = Number.isFinite(roll) ? roll : 0;
    const safePitch = Number.isFinite(pitch) ? pitch : 0;

    useEffect(() => {
        const canvas = canvasRef.current;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = size * dpr;
        canvas.height= size * dpr;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        drawAttitude(ctx, size, safeRoll, safePitch); 
        //gambar diperbarui saat nilai komponen berubah
    }, [safeRoll, safePitch, size]);

    return (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2">
            <div className="w-full text-left"><h2 className="text-sm font-bold tracking-wide text-slate-100">Attitude</h2></div>
            <canvas
              ref={canvasRef}
              style={{ width: Math.min(size, 190), height: Math.min(size, 190)}}
            />

            <div className="flex w-full justify-center gap-5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs font-semibold text-slate-200 tabular-nums">
                ROLL {safeRoll.toFixed(1)}° PITCH {safePitch.toFixed(1)}°
            </div>
        </div>
    );
}
