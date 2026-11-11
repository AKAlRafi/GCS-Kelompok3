let counter = 0;
// make unique id for every waypoints
export const newId = () => `wp-${Date.now()}-${counter++}`;

//menyesuaikan data wp from BEnd
export const normalizeWp = (list =[]) =>
    list.map((w) => ({ //tiap wp dalam array
        id: newId(),
        lat: Number(w.lat),
        lon: Number(w.lon),
        alt: Number(w.alt ?? 50),

    }));


