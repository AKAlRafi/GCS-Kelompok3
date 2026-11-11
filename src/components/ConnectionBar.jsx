export default function ConnectionBar ({
    uavConnected,
    setUavConnected,
    socketConnected,
}) {
    return (
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-950 px-4 py-2">
            <h1 className="text-lg font-bold tracking-wide">
                GCS <span className="text-sky-400">Lite</span>
            </h1>

            <div className="flex items-center gap-4 text-xs text-slate-300">
                <Status label="Server" ok={socketConnected} />
                <Status label="UAV (test)" ok={uavConneccted} />
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setUavConnected(!uavConnected)}
                  classname={`rounded px-4 py-1 text-sm font-semibold ${
                    uavConnected
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-green-600 hover:bg-green-500"
                  }`}
                >
                  {uavConnected ? "Disconnect Simulation" : "Connect Simulation"}
                </button>
            </div>
        </header>
    );
}

function Status({ label, ok}) {
    return (
        <span className="flex items-center gap-1.5">
            <span
                className={`h-2.5 w-2.5 rounded-full %{
                    ok ? "bg-green-500" : "bg-red-500"
                }`}
            />
            {label}
        </span>
    );
}