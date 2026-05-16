/**
 * Paris metro + RER station database.
 * Coordinates are approximate centroid of each station entrance (~20–80m accuracy).
 * Lines: '1'–'14' for metro, 'A'–'E' for RER.
 */

export interface MetroStation {
  name: string
  lat: number
  lng: number
  lines: string[]
}

// ─── Raw data: [name, lat, lng, ...lines][] ───────────────────────────────
// Interchange stations may appear multiple times; MERGED deduplicates them.

const RAW: [string, number, number, ...string[]][] = [

  // ── Line 1 (La Défense ↔ Château de Vincennes) ───────────────────────────
  ['La Défense Grande Arche',       48.8917, 2.2380, '1'],
  ['Esplanade de La Défense',       48.8895, 2.2478, '1'],
  ['Pont de Neuilly',               48.8842, 2.2558, '1'],
  ['Les Sablons',                   48.8789, 2.2636, '1'],
  ['Porte Maillot',                 48.8778, 2.2817, '1'],
  ['Argentine',                     48.8752, 2.2930, '1'],
  ['Charles de Gaulle-Étoile',      48.8737, 2.2950, '1', '2', '6', 'A'],
  ['George V',                      48.8715, 2.3019, '1'],
  ['Franklin D. Roosevelt',         48.8691, 2.3118, '1', '9'],
  ['Champs-Élysées-Clemenceau',     48.8660, 2.3134, '1', '13'],
  ['Concorde',                      48.8654, 2.3215, '1', '8', '12'],
  ['Tuileries',                     48.8635, 2.3347, '1'],
  ['Palais Royal-Musée du Louvre',  48.8635, 2.3367, '1', '7'],
  ['Louvre-Rivoli',                 48.8602, 2.3453, '1'],
  ['Châtelet',                      48.8585, 2.3477, '1', '4', '7', '11', '14'],
  ['Hôtel de Ville',                48.8573, 2.3519, '1', '11'],
  ['Saint-Paul',                    48.8547, 2.3611, '1'],
  ['Bastille',                      48.8533, 2.3692, '1', '5', '8'],
  ['Gare de Lyon',                  48.8449, 2.3735, '1', '14', 'A', 'D'],
  ['Reuilly-Diderot',               48.8481, 2.3875, '1', '8'],
  ['Nation',                        48.8484, 2.3962, '1', '2', '6', '9', 'A', 'D'],
  ['Porte de Vincennes',            48.8486, 2.4131, '1'],
  ['Saint-Mandé',                   48.8449, 2.4166, '1'],
  ['Bérault',                       48.8419, 2.4284, '1'],
  ['Château de Vincennes',          48.8434, 2.4392, '1'],

  // ── Line 2 (Charles de Gaulle-Étoile ↔ Nation) ──────────────────────────
  ['Courcelles',                    48.8789, 2.2972, '2'],
  ['Monceau',                       48.8816, 2.3051, '2'],
  ['Villiers',                      48.8844, 2.3087, '2', '3'],
  ['Rome',                          48.8844, 2.3189, '2'],
  ['Place de Clichy',               48.8834, 2.3250, '2', '13'],
  ['Blanche',                       48.8840, 2.3277, '2'],
  ['Pigalle',                       48.8842, 2.3332, '2', '12'],
  ['Anvers',                        48.8842, 2.3445, '2'],
  ['Barbès-Rochechouart',           48.8837, 2.3499, '2', '4'],
  ['La Chapelle',                   48.8828, 2.3564, '2'],
  ['Stalingrad',                    48.8844, 2.3692, '2', '5', '7'],
  ['Jaurès',                        48.8827, 2.3705, '2', '5', '7bis'],
  ['Belleville',                    48.8714, 2.3788, '2', '11'],
  ['Couronnes',                     48.8690, 2.3789, '2'],
  ['Ménilmontant',                  48.8689, 2.3876, '2'],
  ['Gambetta',                      48.8653, 2.3982, '2', '3', '3bis'],
  ['Père Lachaise',                 48.8607, 2.3945, '2', '3'],
  ['Philippe Auguste',              48.8617, 2.3925, '2'],
  ['Alexandre Dumas',               48.8567, 2.3968, '2'],

  // ── Line 3 (Pont de Levallois ↔ Gallieni) ───────────────────────────────
  ['Pont de Levallois-Bécon',       48.8970, 2.2894, '3'],
  ['Anatole France',                48.8934, 2.2968, '3'],
  ['Louise Michel',                 48.8905, 2.3025, '3'],
  ['Porte de Champerret',           48.8886, 2.2945, '3'],
  ['Pereire',                       48.8894, 2.3085, '3'],
  ['Wagram',                        48.8866, 2.3128, '3'],
  ['Malesherbes',                   48.8840, 2.3155, '3'],
  ['Europe',                        48.8796, 2.3172, '3'],
  ['Saint-Lazare',                  48.8752, 2.3248, '3', '12', '13', '14', 'E'],
  ['Havre-Caumartin',               48.8741, 2.3299, '3', '9'],
  ['Opéra',                         48.8718, 2.3311, '3', '7', '8'],
  ['Quatre-Septembre',              48.8706, 2.3380, '3'],
  ['Bourse',                        48.8673, 2.3418, '3'],
  ['Sentier',                       48.8656, 2.3473, '3'],
  ['Réaumur-Sébastopol',            48.8656, 2.3498, '3', '4'],
  ['Arts et Métiers',               48.8638, 2.3562, '3', '11'],
  ['Temple',                        48.8628, 2.3617, '3'],
  ['République',                    48.8672, 2.3629, '3', '5', '8', '9', '11'],
  ['Rue Saint-Maur',                48.8618, 2.3852, '3'],
  ['Porte de Bagnolet',             48.8621, 2.4097, '3'],
  ['Gallieni',                      48.8596, 2.4173, '3'],

  // ── Line 3bis (Gambetta ↔ Saint-Fargeau) ────────────────────────────────
  ['Saint-Fargeau',                 48.8752, 2.4017, '3bis'],
  ['Pelleport',                     48.8699, 2.4003, '3bis'],

  // ── Line 4 (Montrouge ↔ Porte de Clignancourt) ──────────────────────────
  ['Porte de Clignancourt',         48.9023, 2.3467, '4'],
  ['Simplon',                       48.8959, 2.3483, '4'],
  ['Marcadet-Poissonniers',         48.8904, 2.3579, '4', '12'],
  ['Château Rouge',                 48.8875, 2.3496, '4'],
  ['Gare du Nord',                  48.8809, 2.3553, '4', '5', 'B', 'D', 'E'],
  ["Gare de l'Est",                 48.8770, 2.3568, '4', '5', '7'],
  ["Château d'Eau",                 48.8683, 2.3575, '4'],
  ['Strasbourg-Saint-Denis',        48.8679, 2.3519, '4', '8', '9'],
  ['Étienne Marcel',                48.8637, 2.3512, '4'],
  ['Les Halles',                    48.8629, 2.3476, '4'],
  ['Cité',                          48.8548, 2.3464, '4'],
  ['Saint-Michel',                  48.8531, 2.3466, '4', 'B', 'C'],
  ['Odéon',                         48.8522, 2.3431, '4', '10'],
  ['Saint-Germain-des-Prés',        48.8540, 2.3325, '4'],
  ['Saint-Sulpice',                 48.8508, 2.3328, '4'],
  ['Saint-Placide',                 48.8471, 2.3293, '4'],
  ['Montparnasse-Bienvenue',        48.8420, 2.3215, '4', '6', '12', '13'],
  ['Vavin',                         48.8438, 2.3301, '4'],
  ['Raspail',                       48.8389, 2.3275, '4', '6'],
  ['Denfert-Rochereau',             48.8337, 2.3325, '4', '6', 'B'],
  ['Mouton-Duvernet',               48.8334, 2.3251, '4'],
  ['Alésia',                        48.8281, 2.3247, '4'],
  ['Montrouge-Bagneux-Lucie Aubrac',48.8159, 2.3168, '4'],

  // ── Line 5 (Bobigny Pablo Picasso ↔ Place d'Italie) ─────────────────────
  ['Bobigny-Pablo Picasso',         48.9063, 2.4467, '5'],
  ['Bobigny-Pantin-Raymond Queneau',48.9031, 2.4256, '5'],
  ['Église de Pantin',              48.8966, 2.4026, '5'],
  ['Hoche',                         48.8885, 2.4000, '5'],
  ['Prés-Saint-Gervais',            48.8830, 2.3988, '5'],
  ['Place des Fêtes',               48.8769, 2.3936, '5', '7bis'],
  ['Jourdain',                      48.8748, 2.3887, '5'],
  ['Pyrénées',                      48.8721, 2.3882, '11'],
  ['Jacques Bonsergent',            48.8704, 2.3593, '5'],
  ['Breguet-Sabin',                 48.8577, 2.3693, '5'],
  ['Richard-Lenoir',                48.8629, 2.3694, '5'],
  ['Quai de la Rapée',              48.8464, 2.3720, '5'],
  ["Gare d'Austerlitz",             48.8430, 2.3659, '5', '10', 'C'],
  ['Saint-Marcel',                  48.8399, 2.3594, '5'],
  ['Campo-Formio',                  48.8351, 2.3563, '5'],
  ["Place d'Italie",                48.8309, 2.3555, '5', '6', '7'],

  // ── Line 6 (Charles de Gaulle-Étoile ↔ Nation, via Sud) ─────────────────
  ['Kléber',                        48.8701, 2.2932, '6'],
  ['Boissière',                     48.8666, 2.2903, '6'],
  ['Trocadéro',                     48.8626, 2.2893, '6', '9'],
  ['Passy',                         48.8578, 2.2853, '6'],
  ['Bir-Hakeim',                    48.8534, 2.2891, '6', 'C'],
  ['Dupleix',                       48.8503, 2.2942, '6'],
  ['La Motte-Picquet-Grenelle',     48.8492, 2.3000, '6', '8', '10'],
  ['Sèvres-Lecourbe',               48.8455, 2.3087, '6'],
  ['Cambronne',                     48.8449, 2.3136, '6'],
  ['Pasteur',                       48.8440, 2.3171, '6', '12'],
  ['Edgar Quinet',                  48.8413, 2.3233, '6'],
  ['Saint-Jacques',                 48.8367, 2.3343, '6'],
  ['Glacière',                      48.8336, 2.3448, '6'],
  ['Corvisart',                     48.8306, 2.3501, '6'],
  ['Nationale',                     48.8269, 2.3576, '6'],
  ['Chevaleret',                    48.8247, 2.3642, '6'],
  ['Quai de la Gare',               48.8321, 2.3720, '6'],
  ['Bercy',                         48.8387, 2.3793, '6', '14'],
  ['Dugommier',                     48.8406, 2.3870, '6'],
  ['Daumesnil',                     48.8399, 2.3947, '6', '8'],
  ['Bel-Air',                       48.8429, 2.4030, '6'],
  ['Picpus',                        48.8467, 2.4075, '6'],

  // ── Line 7 (La Courneuve ↔ Mairie d'Ivry / Villejuif) ───────────────────
  ["La Courneuve-8 Mai 1945",       48.9266, 2.3929, '7'],
  ["Fort d'Aubervilliers",          48.9193, 2.3965, '7'],
  ['Aubervilliers-Pantin-4 Chemins',48.9138, 2.3922, '7'],
  ['Riquet',                        48.8937, 2.3700, '7'],
  ['Crimée',                        48.8943, 2.3725, '7'],
  ['Corentin Cariou',               48.8990, 2.3722, '5'],
  ['Ourcq',                         48.8915, 2.3833, '5'],
  ['Laumière',                      48.8879, 2.3766, '5'],
  ['Louis Blanc',                   48.8774, 2.3625, '7', '7bis'],
  ['Colonel Fabien',                48.8716, 2.3693, '5'],
  ['Cadet',                         48.8762, 2.3453, '7'],
  ['Le Peletier',                   48.8753, 2.3388, '7'],
  ["Chaussée d'Antin-La Fayette",   48.8731, 2.3341, '7', '9'],
  ['Pyramides',                     48.8654, 2.3336, '7', '14'],
  ['Pont Neuf',                     48.8572, 2.3432, '7'],
  ['Pont Marie',                    48.8533, 2.3554, '7'],
  ['Sully-Morland',                 48.8505, 2.3574, '7'],
  ['Jussieu',                       48.8464, 2.3544, '7', '10'],
  ['Place Monge',                   48.8437, 2.3517, '7'],
  ['Censier-Daubenton',             48.8406, 2.3521, '7'],
  ['Les Gobelins',                  48.8354, 2.3533, '7'],
  ['Tolbiac',                       48.8277, 2.3588, '7'],
  ['Maison Blanche',                48.8214, 2.3600, '7'],
  ['Kremlin-Bicêtre',               48.8139, 2.3626, '7'],
  ['Villejuif-Louis Aragon',        48.7985, 2.3647, '7'],

  // ── Line 7bis (Louis Blanc ↔ Pré-Saint-Gervais) ─────────────────────────
  ['Bolivar',                       48.8789, 2.3762, '7bis'],
  ['Botzaris',                      48.8772, 2.3820, '7bis'],
  ['Buttes-Chaumont',               48.8773, 2.3863, '7bis'],

  // ── Line 8 (Balard ↔ Pointe du Lac) ─────────────────────────────────────
  ['Balard',                        48.8391, 2.2793, '8'],
  ['Lourmel',                       48.8381, 2.2885, '8'],
  ['Boucicaut',                     48.8396, 2.2985, '8'],
  ['Félix Faure',                   48.8413, 2.3069, '8'],
  ['Commerce',                      48.8424, 2.3086, '8'],
  ['Avron',                         48.8490, 2.4044, '9'],
  ['École Militaire',               48.8555, 2.3062, '8'],
  ['La Tour-Maubourg',              48.8572, 2.3099, '8'],
  ['Richelieu-Drouot',              48.8732, 2.3415, '8', '9'],
  ['Grands Boulevards',             48.8710, 2.3449, '8', '9'],
  ['Bonne Nouvelle',                48.8694, 2.3489, '8', '9'],
  ['Faidherbe-Chaligny',            48.8516, 2.3856, '8'],

  // ── Line 9 (Pont de Sèvres ↔ Mairie de Montreuil) ───────────────────────
  ['Pont de Sèvres',                48.8257, 2.2296, '9'],
  ['Billancourt',                   48.8323, 2.2426, '9', '10'],
  ['Marcel Sembat',                 48.8355, 2.2513, '9'],
  ['Pont de Saint-Cloud',           48.8373, 2.2559, '9', '10'],
  ['Exelmans',                      48.8435, 2.2658, '9'],
  ['Michel-Ange-Molitor',           48.8463, 2.2699, '9', '10'],
  ['Michel-Ange-Auteuil',           48.8468, 2.2713, '9', '10'],
  ['Jasmin',                        48.8515, 2.2734, '9'],
  ['Ranelagh',                      48.8548, 2.2762, '9'],
  ['La Muette',                     48.8590, 2.2769, '9'],
  ['Rue de la Pompe',               48.8628, 2.2787, '9'],
  ['Victor Hugo',                   48.8672, 2.2865, '2'],
  ["Iéna",                          48.8657, 2.2941, '9'],
  ['Alma-Marceau',                  48.8636, 2.3011, '9'],
  ['Miromesnil',                    48.8749, 2.3143, '9', '13'],
  ['Saint-Augustin',                48.8764, 2.3191, '9'],
  ['Charonne',                      48.8554, 2.3837, '9'],
  ['Rue des Boulets',               48.8539, 2.3901, '9'],
  ['Buzenval',                      48.8514, 2.4074, '9'],
  ['Maraîchers',                    48.8548, 2.4113, '9'],
  ['Croix de Chavaux',              48.8585, 2.4289, '9'],
  ['Mairie de Montreuil',           48.8628, 2.4397, '9'],

  // ── Line 10 (Boulogne-Pont de Saint-Cloud ↔ Gare d'Austerlitz) ──────────
  ['Boulogne-Pont de Saint-Cloud',  48.8373, 2.2313, '10'],
  ['Boulogne-Jean Jaurès',          48.8345, 2.2391, '10'],
  ['Chardon-Lagache',               48.8440, 2.2694, '10'],
  ['Mirabeau',                      48.8466, 2.2735, '10'],
  ['Javel-André Citroën',           48.8459, 2.2807, '10'],
  ['Charles Michels',               48.8457, 2.2866, '10'],
  ['Émile Zola',                    48.8451, 2.2941, '10'],
  ['Ségur',                         48.8480, 2.3082, '10'],
  ['Sèvres-Babylone',               48.8512, 2.3247, '10', '12'],
  ['Mabillon',                      48.8531, 2.3345, '10'],
  ['Cluny-La Sorbonne',             48.8504, 2.3467, '10'],
  ['Cardinal Lemoine',              48.8474, 2.3524, '10'],
  ['Duroc',                         48.8471, 2.3167, '10', '13'],

  // ── Line 11 (Châtelet ↔ Rosny-Bois-Perrier) ─────────────────────────────
  ['Rambuteau',                     48.8605, 2.3519, '11'],
  ['Goncourt',                      48.8681, 2.3688, '11'],
  ['Mairie des Lilas',              48.8806, 2.4151, '11'],

  // ── Line 12 (Front Populaire ↔ Mairie d'Issy) ───────────────────────────
  ['Front Populaire',               48.9198, 2.3630, '12'],
  ['Porte de la Chapelle',          48.9074, 2.3585, '12'],
  ['Marx Dormoy',                   48.8934, 2.3612, '12'],
  ['Jules Joffrin',                 48.8895, 2.3440, '12'],
  ['Lamarck-Caulaincourt',          48.8900, 2.3381, '12'],
  ['Abbesses',                      48.8843, 2.3385, '12'],
  ['Saint-Georges',                 48.8793, 2.3356, '12'],
  ['Notre-Dame-de-Lorette',         48.8770, 2.3377, '12'],
  ["Trinité-d'Estienne-d'Orves",    48.8760, 2.3330, '12'],
  ['Madeleine',                     48.8701, 2.3253, '8', '12', '14'],
  ['Assemblée Nationale',           48.8602, 2.3198, '12'],
  ['Solférino',                     48.8607, 2.3228, '12'],
  ['Rue du Bac',                    48.8562, 2.3248, '12'],
  ['Vaugirard',                     48.8382, 2.3068, '12'],
  ['Corentin Celton',               48.8261, 2.2969, '12'],
  ["Mairie d'Issy",                 48.8225, 2.2752, '12'],

  // ── Line 13 (Saint-Denis / Asnières ↔ Châtillon-Montrouge) ─────────────
  ['Saint-Denis-Université',        48.9409, 2.3534, '13'],
  ['Basilique de Saint-Denis',      48.9353, 2.3547, '13'],
  ['Saint-Denis-Porte de Paris',    48.9291, 2.3568, '13'],
  ['Carrefour Pleyel',              48.9217, 2.3302, '13'],
  ['Mairie de Saint-Ouen',          48.9115, 2.3335, '13'],
  ['Garibaldi',                     48.9031, 2.3373, '13'],
  ['Guy Môquet',                    48.8972, 2.3424, '13'],
  ['La Fourche',                    48.8913, 2.3240, '13'],
  ['Liège',                         48.8794, 2.3263, '13'],
  ['Varenne',                       48.8539, 2.3153, '13'],
  ['Saint-François-Xavier',         48.8497, 2.3116, '13'],
  ['Châtillon-Montrouge',           48.8099, 2.3109, '13'],
  ['Malakoff-Plateau de Vanves',    48.8152, 2.3013, '13'],
  ['Malakoff-Rue Étienne Dolet',    48.8168, 2.3052, '13'],
  ['Plaisance',                     48.8316, 2.3148, '13'],
  ['Pernety',                       48.8328, 2.3163, '13'],

  // ── Line 14 (Olympiades ↔ Saint-Ouen) ────────────────────────────────────
  ['Olympiades',                    48.8245, 2.3647, '14'],
  ['Bibliothèque François Mitterrand',48.8299, 2.3762, '14'],
  ['Cour Saint-Émilion',            48.8351, 2.3840, '14'],

  // ── RER A ─────────────────────────────────────────────────────────────────
  ['Nanterre-Préfecture',           48.8929, 2.2125, 'A'],
  ['Auber',                         48.8741, 2.3313, 'A'],
  ['Châtelet-Les Halles',           48.8618, 2.3476, 'A', 'B', 'D'],
  ['Vincennes',                     48.8479, 2.4383, 'A'],
  ['Joinville-le-Pont',             48.8188, 2.4674, 'A'],
  ['Boissy-Saint-Léger',            48.7524, 2.5081, 'A'],

  // ── RER B ─────────────────────────────────────────────────────────────────
  ['Aéroport Charles de Gaulle',    49.0044, 2.5695, 'B'],
  ['La Plaine-Stade de France',     48.9193, 2.3618, 'B', 'D'],
  ['Luxembourg',                    48.8473, 2.3373, 'B'],
  ['Port-Royal',                    48.8387, 2.3372, 'B'],
  ['Bagneux-Lucie Aubrac',          48.7987, 2.3108, 'B'],
  ['Robinson',                      48.7786, 2.2855, 'B'],

  // ── RER C ─────────────────────────────────────────────────────────────────
  ["Musée d'Orsay",                 48.8600, 2.3271, 'C'],
  ['Champ de Mars-Tour Eiffel',     48.8558, 2.2952, 'C'],
  ['Javel',                         48.8459, 2.2807, 'C'],
  ['Austerlitz',                    48.8430, 2.3659, '5', '10', 'C'],

  // ── RER D ─────────────────────────────────────────────────────────────────
  // (shared stations already covered above)

  // ── RER E ─────────────────────────────────────────────────────────────────
  ['Magenta',                       48.8809, 2.3574, 'E'],
  ['Haussmann-Saint-Lazare',        48.8752, 2.3248, 'E'],
]

// ─── Build deduplicated station list ──────────────────────────────────────

const MERGED: Record<string, { lat: number; lng: number; lines: Set<string> }> = {}

for (const [name, lat, lng, ...lines] of RAW) {
  if (!MERGED[name]) {
    MERGED[name] = { lat, lng, lines: new Set(lines) }
  } else {
    lines.forEach((l) => MERGED[name].lines.add(l))
  }
}

export const METRO_STATIONS: MetroStation[] = Object.entries(MERGED).map(
  ([name, { lat, lng, lines }]) => ({ name, lat, lng, lines: [...lines] })
)

// ─── Lookup helpers ────────────────────────────────────────────────────────

/** All stations serving a given line (e.g. '2', 'A', 'B') */
export function getStationsByLine(line: string): MetroStation[] {
  const normalized = line.toUpperCase().trim()
  return METRO_STATIONS.filter((s) =>
    s.lines.some((l) => l.toUpperCase() === normalized)
  )
}

/** Find a station by name (case-insensitive partial match) */
export function findStation(query: string): MetroStation | null {
  const q = query.toLowerCase().trim()
  return (
    METRO_STATIONS.find((s) => s.name.toLowerCase() === q) ??
    METRO_STATIONS.find((s) => s.name.toLowerCase().includes(q)) ??
    null
  )
}

/** Normalize common line aliases: "ligne 2" → "2", "ligne A" → "A", "rer b" → "B" */
export function normalizeLineId(raw: string): string {
  const s = raw.toLowerCase().trim()
  const m = s.match(/^(?:ligne|m[eé]tro|rer)\s*([0-9]{1,2}(?:bis)?|[a-e])$/)
  if (m) return m[1].toUpperCase()
  return raw.toUpperCase().trim()
}
