import './hud.css'

const compassMarks = Array.from({ length: 36 }, (_, index) => {
  const angle = index * 10
  const major = angle % 30 === 0
  return (
    <line
      key={angle}
      x1="80"
      y1={major ? '10' : '14'}
      x2="80"
      y2="20"
      transform={`rotate(${angle} 80 80)`}
      className={major ? 'compass-mark major' : 'compass-mark'}
    />
  )
})

function angleLabel(value) {
  const angle = Number(value)
  return Number.isFinite(angle) ? `${angle.toFixed(1)}°` : '—°'
}

function directionLabel(value) {
  const angle = Number(value)
  if (!Number.isFinite(angle)) return '—'
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((angle % 360) + 360) % 360) / 45) % 8]
}

export default function Hud({ telemetry = {}, mapBearing = 0, followVehicle = false, onToggleFollow }) {
  const roll = Number(telemetry.roll)
  const pitch = Number(telemetry.pitch)
  const heading = Number(telemetry.heading ?? telemetry.yaw)
  const hasHeading = Number.isFinite(heading)
  const compassBearing = hasHeading ? ((heading % 360) + 360) % 360 : 0
  const horizonRoll = Number.isFinite(roll) ? -roll : 0
  const horizonPitch = Number.isFinite(pitch) ? Math.max(-30, Math.min(30, pitch * 1.5)) : 0

  return (
    <section className="hud-panel" aria-label="Flight instruments">
      <div className="hud-header">
        <h2>HUD</h2>
        <button
          className={`hud-follow${followVehicle ? ' active' : ''}`}
          type="button"
          aria-pressed={followVehicle}
          title={followVehicle ? 'Switch to north-up map' : 'Follow drone with its nose at the top'}
          onClick={onToggleFollow}
        >
          {followVehicle ? 'FOLLOW ON' : 'FOLLOW'}
        </button>
      </div>

      <div className="hud-gauges">
        <div className="hud-instrument">
          <svg className="attitude-gauge" viewBox="0 0 160 160" role="img" aria-label={`Attitude: roll ${angleLabel(roll)}, pitch ${angleLabel(pitch)}`}>
          <defs>
            <clipPath id="attitude-clip">
              <circle cx="80" cy="80" r="73" />
            </clipPath>
          </defs>
          <circle className="gauge-face" cx="80" cy="80" r="77" />
          <g clipPath="url(#attitude-clip)">
            <g transform={`rotate(${(360 - compassBearing) % 360} 80 80)`}>
              <rect className="attitude-sky" x="-100" y="-300" width="360" height="380" />
              <rect className="attitude-ground" x="-100" y="80" width="360" height="400" />
              <line className="attitude-horizon" x1="-100" y1="80" x2="260" y2="80" />
              <g className="attitude-ladder">
              <line x1="45" y1="62" x2="70" y2="62" />
              <line x1="90" y1="62" x2="115" y2="62" />
              <line x1="38" y1="80" x2="67" y2="80" />
              <line x1="93" y1="80" x2="122" y2="80" />
              <line x1="45" y1="98" x2="70" y2="98" />
              <line x1="90" y1="98" x2="115" y2="98" />
              <text x="57" y="58">10</text>
              <text x="98" y="58">10</text>
              <text x="57" y="112">10</text>
              <text x="98" y="112">10</text>
              </g>
            </g>
          </g>
          <path className="attitude-pointer" d="M71 12h18l-9 16z" />
          <path className="aircraft-mark" d="M38 80h31l11 5 11-5h31M80 75v10" />
          <circle className="gauge-center" cx="80" cy="80" r="3" />
          </svg>
          <span className="hud-label">ATTITUDE</span>
          <span className="hud-reading">R {angleLabel(roll)} &nbsp; P {angleLabel(pitch)}</span>
        </div>

        <div className="hud-instrument">
          <svg className="compass-gauge" viewBox="0 0 160 160" role="img" aria-label={`Map compass ${angleLabel(compassBearing)} ${directionLabel(compassBearing)}`}>
          <circle className="gauge-face compass-face" cx="80" cy="80" r="77" />
          <g transform={`rotate(${compassBearing} 80 80)`}>
            {compassMarks}
            <text className="compass-cardinal north" x="80" y="38">N</text>
            <text className="compass-cardinal" x="122" y="84">E</text>
            <text className="compass-cardinal" x="80" y="132">S</text>
            <text className="compass-cardinal" x="38" y="84">W</text>
          </g>
          <path className="compass-pointer" d="M80 5l-8 18h16z" />
          <rect className="compass-reading-box" x="56" y="68" width="48" height="25" rx="2" />
          <text className="compass-reading" x="80" y="86">{hasHeading ? Math.round(compassBearing).toString().padStart(3, '0') : '---'}</text>
          </svg>
          <span className="hud-label">COMPASS</span>
          <span className="hud-reading">{angleLabel(compassBearing)} {directionLabel(compassBearing)}</span>
        </div>
      </div>
    </section>
  )
}
