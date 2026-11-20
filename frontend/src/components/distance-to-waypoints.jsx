import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../services/socket';
import './distance-to-waypoints.css';

const NON_NAV_COMMANDS = new Set([
    'TAKEOFF',
    'NAV_TAKEOFF',
    'RTL',
    'RETURN_TO_LAUNCH',
    'LAND',
    'NAV_LAND',
    20,
    21,
    22,
]);

function haversineMeters(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(1)} m`;
}

export default function DistanceToWaypoint({ waypoints = [] }) {
    const [distance, setDistance] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [finished, setFinished] = useState(false);

    const activeIndexRef = useRef(0);
    const minDistanceRef = useRef(Infinity);
    const holdRef = useRef(false);

    const validWaypoints = useMemo(() => {
        return waypoints
        .filter((wp) => {
            const cmd =
            typeof wp?.command === 'string' ? wp.command.toUpperCase() : wp?.command;
            const type =
            typeof wp?.type === 'string' ? wp.type.toUpperCase() : wp?.type;
            return !NON_NAV_COMMANDS.has(cmd) && !NON_NAV_COMMANDS.has(type);
        })
        .map((wp) => ({
            lat: Number(wp?.lat ?? wp?.latitude),
            lon: Number(wp?.lon ?? wp?.lng ?? wp?.longitude),
        }))
        .filter(
            (wp) =>
            Number.isFinite(wp.lat) &&
            Number.isFinite(wp.lon) &&
            (wp.lat !== 0 || wp.lon !== 0)
        );
    }, [waypoints]);

    const waypointsKey = JSON.stringify(validWaypoints);

    // Reset hanya jika koordinat waypoint benar-benar berubah (bukan saat parent re-render)
    useEffect(() => {
        activeIndexRef.current = 0;
        minDistanceRef.current = Infinity;
        holdRef.current = false;
        setActiveIndex(0);
        setFinished(false);
        setDistance(null);
    }, [waypointsKey]);

    useEffect(() => {
        let holdTimer;

        const onTelemetry = (data) => {
        if (!data || holdRef.current || validWaypoints.length === 0) return;

        const lat = Number(data.lat);
        const lon = Number(data.lon ?? data.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const idx = activeIndexRef.current;
        const target = validWaypoints[idx];
        if (!target) return;

        const dist = haversineMeters(lat, lon, target.lat, target.lon);
        if (dist < minDistanceRef.current) {
            minDistanceRef.current = dist;
        }
        setDistance(dist);
        };

        const onWpReached = (data) => {
        if (!data || validWaypoints.length === 0) return;

        const seq = Number(data.seq);
        if (!Number.isFinite(seq) || seq <= 0) return;

        // Jika seq === 1 tapi wahana belum pernah mendekati WP-1 (< 100 m), berarti seq 1 adalah Takeoff
        if (seq === 1 && activeIndexRef.current === 0 && minDistanceRef.current > 100) {
            return;
        }

        holdRef.current = true;
        setDistance(0);

        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
            holdRef.current = false;
            const nextIdx = activeIndexRef.current + 1;

            if (nextIdx < validWaypoints.length) {
            activeIndexRef.current = nextIdx;
            minDistanceRef.current = Infinity;
            setActiveIndex(nextIdx);
            } else {
            setFinished(true);
            }
        }, 600);
        };

        socket.on('telemetry', onTelemetry);
        socket.on('waypoint_reached', onWpReached);

        return () => {
        clearTimeout(holdTimer);
        socket.off('telemetry', onTelemetry);
        socket.off('waypoint_reached', onWpReached);
        };
    }, [waypointsKey]);

    let text = 'Jarak ke WP-1: --';
    if (finished && validWaypoints.length > 0) {
        text = 'Semua waypoint tercapai';
    } else if (distance !== null) {
        text = `Jarak ke WP-${activeIndex + 1}: ${formatDistance(distance)}`;
    }

    return <div className="wp-distance-container">{text}</div>;
}