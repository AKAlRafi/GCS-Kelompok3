const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function validCoordinate(value, min, max) {
  return Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
}

function hitungJarakMeter(lat1, lon1, lat2, lon2) {
  if (![validCoordinate(lat1, -90, 90), validCoordinate(lat2, -90, 90),
    validCoordinate(lon1, -180, 180), validCoordinate(lon2, -180, 180)].every(Boolean)) {
    throw new Error('Koordinat harus berupa latitude dan longitude yang valid.');
  }
  const dLat = (Number(lat2) - Number(lat1)) * RAD;
  const dLon = (Number(lon2) - Number(lon1)) * RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(Number(lat1) * RAD) * Math.cos(Number(lat2) * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hitungArahBearing(lat1, lon1, lat2, lon2) {
  if (![validCoordinate(lat1, -90, 90), validCoordinate(lat2, -90, 90),
    validCoordinate(lon1, -180, 180), validCoordinate(lon2, -180, 180)].every(Boolean)) {
    throw new Error('Koordinat harus berupa latitude dan longitude yang valid.');
  }
  const fromLat = Number(lat1) * RAD;
  const toLat = Number(lat2) * RAD;
  const dLon = (Number(lon2) - Number(lon1)) * RAD;
  const y = Math.sin(dLon) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat)
    - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(dLon);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

function hitungSudutBelok(headingSekarang, bearingTujuan, toleransi = 3) {
  if (![headingSekarang, bearingTujuan].every((value) => Number.isFinite(Number(value)))) {
    throw new Error('Heading dan bearing harus berupa angka.');
  }
  const sudut = ((Number(bearingTujuan) - Number(headingSekarang) + 540) % 360) - 180;
  const arah = Math.abs(sudut) <= toleransi ? 'LURUS' : sudut > 0 ? 'KANAN' : 'KIRI';
  return {
    sudut_belok: Math.abs(sudut) <= toleransi ? 0 : Number(sudut.toFixed(2)),
    arah,
    instruksi: arah === 'LURUS' ? 'Lurus ke tujuan' : `Putar ${arah === 'KANAN' ? 'kanan' : 'kiri'} ${Math.abs(sudut).toFixed(2)} derajat`
  };
}

function hitungSelisihKetinggian(altSekarang, altTarget) {
  if (![altSekarang, altTarget].every((value) => Number.isFinite(Number(value)))) {
    throw new Error('Ketinggian sekarang dan target harus berupa angka.');
  }
  return Number((Number(altTarget) - Number(altSekarang)).toFixed(2));
}

module.exports = { hitungJarakMeter, hitungArahBearing, hitungSudutBelok, hitungSelisihKetinggian };
