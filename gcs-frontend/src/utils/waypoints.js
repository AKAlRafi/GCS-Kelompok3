// kelola identitas dan format wp
let counter = 0; //hitung wp

// make unique id for every waypoints
export const newId = () => `wp-${Date.now()}-${counter++}`;

//menyesuaikan data wp from BEnd
export const normalizeWp = (list =[]) => //gada data, pake array kosong
    list.map((w) => ({ //tiap wp dalam array
        id: newId(),
        lat: Number(w.lat),
        lon: Number(w.lon),
        alt: Number(w.alt ?? 50), //default 50

    }));

//react need identitas wp


