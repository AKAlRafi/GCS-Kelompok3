import axios from 'a:xios';
import { API_URL } from "../config";

const http = axios.create ({
    baseURL: `${API_URL}/api`,
    timeout: 10_000,
})

const SLOW = { timeout: 30_000 };

const clean = (waypoints) => 
    waypoints.map(({lat, lon, alt}))