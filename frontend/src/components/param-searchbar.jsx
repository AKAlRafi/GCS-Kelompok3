import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadParametersFromVehicle } from '../services/parameters'
import './param-search.css'

export default function ParameterSearch() {
    const [params, setParams] = useState([]);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);
    const boxRef = useRef(null);
    const LIMIT = 5;

    const load = () => {
        setLoading(true);
        setError('')
        downloadParametersFromVehicle()
        .then((list) => { 
            setParams(list);
            setLoaded(true);
        })
        .catch((e) => setError(e.message || 'Could not load parameters'))
        .finally(() => setLoading(false));
    }

    // Load once for the first time the box is used
    const handleFocus = () => {
        setOpen(true);
        if (!loaded && !loading) load();
    }

    // Close on outside click or ESC button
    useEffect(() => {
        const onDown = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
        }
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', onDown);  
        document.addEventListener('keydown', onKey);     
        return () => {
            document.removeEventListener('mousedown', onDown);  // Mouse click
            document.removeEventListener('keydown', onKey);     // ESC button
        }
    }, [])

    const q = query.trim().toUpperCase();
    const results = useMemo(() => {
        if (!q) return []
        const starts = []
        const contains = []
        for (const p of params) {
        const id = p.id.toUpperCase()
        if (id.startsWith(q)) starts.push(p)
        else if (id.includes(q)) contains.push(p)
        }
        return [...starts, ...contains]
    }, [params, q])

    return (
        <div className="param-search" ref={boxRef}>
        <input
            className="param-search-input"
            type="search"
            placeholder="Search parameters (e.g. SERVO1)"
            value={query}
            onFocus={handleFocus}
            onChange={(e) => { setQuery(e.target.value); LIMIT; setOpen(true) }}
            aria-label="Search parameters"
        />
        {open && q && (
            <div className="param-search-panel">
            <div className="param-search-meta">
                {loading ? 'Loading…' : error ? error : `${Math.min(LIMIT, results.length)} of ${results.length}`}
                <button type="button" onClick={load}>Reload</button>
            </div>
            <ul className="param-search-list">
                {results.slice(0, LIMIT).map((p) => (
                    <li key={p.id}><span>{p.id}</span><b>{p.value ?? '—'}</b></li>
                ))}
                {!loading && !error && results.length === 0 && <li className="empty">No match</li>}
            </ul>
            </div>
        )}
        </div>
    )
}