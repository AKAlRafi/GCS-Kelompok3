import {useEffect, useRef} from 'react';

const DEG = Math.PI / 180;

//for horizon
function drawAttitude(ctx, size, roll, pitch) {
    const c = size /2;
    const r= size/2 - 4;
    const pxPerDeg = r/30;

    ctx.clearRect(0,0, size, size);

    // bagian yang bergerak
    ctx.cave();
    ctx.translate(c, c);

    ctx.beginPath();
    ctx.arc(0,0,r,0,Math.PI*2);
    ctx.clip();

    //roll atas bawah 
    ctx.rotate(-roll * DEG);

    //pitch kanan kiri 
    ctx.save();
    ctx.translate(0, pitch * pxPerDeg);

    //langit
    ctx.fillStyle = '#2563eb';
    ctx.fillreact(-2*r, -4*r, 4*r, 4*r);

    //horizon line 
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(-2*r, 0);
    ctx.lineTo(-2*r, 0);
    ctx.stroke();

    //skala pitch
    [-20, -10, 10, 20].forEach((deg) => {
        const y = -deg * pxPerDeg;
        const half = deg %20 === 0 ? r *0.3 : r*0.18;

        ctx.beginPath();
        ctx.moveTo(-half, y);
        ctx.lineTo(half, y);
        ctx.stroke();

        ctx.font = '110x sans-serief';
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

        ctx.restroke();
     });
    ctx.restroke();

    //instrumen frame
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.stroke();

    //yellow indicator
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(c, c -r +16);
    ctx.lineTo(c-7, c-r+30);
    ctx.lineTo(c+7, c-r+30);
    ctx.closePath();
    ctx.fill();

    //pesawat middle
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath


}