// ACC publishes the raw front brake bias (e.g. 0.75); the value the car's
// own display shows is raw × 100 plus a per-car offset (Kunos' shared memory
// documentation, appendix 4). Unknown cars → null rather than a wrong number.
const OFFSETS = {
  // GT3
  amr_v12_vantage_gt3: -7,
  amr_v8_vantage_gt3: -7,
  audi_r8_lms: -14,
  audi_r8_lms_evo: -14,
  audi_r8_lms_evo_ii: -14,
  bentley_continental_gt3_2016: -7,
  bentley_continental_gt3_2018: -7,
  bmw_m4_gt3: -14,
  bmw_m6_gt3: -15,
  jaguar_g3: -7,
  ferrari_296_gt3: -5,
  ferrari_488_gt3: -17,
  ferrari_488_gt3_evo: -17,
  ford_mustang_gt3: -14,
  honda_nsx_gt3: -14,
  honda_nsx_gt3_evo: -20,
  lamborghini_gallardo_rex: -14,
  lamborghini_huracan_gt3: -14,
  lamborghini_huracan_gt3_evo: -14,
  lamborghini_huracan_gt3_evo2: -14,
  lexus_rc_f_gt3: -14,
  mclaren_650s_gt3: -17,
  mclaren_720s_gt3: -17,
  mclaren_720s_gt3_evo: -17,
  mercedes_amg_gt3: -14,
  mercedes_amg_gt3_evo: -14,
  nissan_gt_r_gt3_2017: -15,
  nissan_gt_r_gt3_2018: -15,
  porsche_991_gt3_r: -21,
  porsche_991ii_gt3_r: -21,
  porsche_992_gt3_r: -21,
  // Cup / ST / Challenge / TCX
  porsche_991ii_gt3_cup: -5,
  porsche_992_gt3_cup: -5,
  lamborghini_huracan_st: -14,
  lamborghini_huracan_st_evo2: -14,
  ferrari_488_challenge_evo: -13,
  bmw_m2_cs_racing: -17,
  // GT4
  alpine_a110_gt4: -15,
  amr_v8_vantage_gt4: -20,
  audi_r8_gt4: -15,
  bmw_m4_gt4: -22,
  chevrolet_camaro_gt4r: -18,
  ginetta_g55_gt4: -18,
  ktm_xbow_gt4: -20,
  maserati_mc_gt4: -15,
  mclaren_570s_gt4: -9,
  mercedes_amg_gt4: -20,
  porsche_718_cayman_gt4_mr: -20,
  // GT2
  audi_r8_lms_gt2: -15,
  ktm_xbow_gt2: -20,
  maserati_mc20_gt2: -5,
  mercedes_amg_gt2: -10,
  porsche_935: -5,
  porsche_991_gt2_rs_mr: -5,
};

export function accBrakeBias(raw, carModel) {
  const offset = OFFSETS[carModel];
  if (offset === undefined || !(raw > 0)) return null;
  return raw * 100 + offset;
}
