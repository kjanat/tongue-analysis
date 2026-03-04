// ── TCM Organ / Element / Zone mappings ─────────────────────────

export type OrganName =
	| 'Hart'
	| 'Long'
	| 'Lever'
	| 'Galblaas'
	| 'Maag'
	| 'Milt'
	| 'Nier'
	| 'Blaas';

export type Element = 'wood' | 'fire' | 'earth' | 'metal' | 'water';

export type TongueZone =
	| 'tongpunt'
	| 'boven-tongpunt'
	| 'linkerrand'
	| 'rechterrand'
	| 'centrum'
	| 'wortel-zijkant'
	| 'wortel-centrum';

/** Five-element label (Dutch + Chinese) and CSS class per element. */
export const ELEMENTS: ReadonlyArray<
	{ readonly name: string; readonly cls: Element }
> = [
	{ name: 'Hout 木', cls: 'wood' },
	{ name: 'Vuur 火', cls: 'fire' },
	{ name: 'Aarde 土', cls: 'earth' },
	{ name: 'Metaal 金', cls: 'metal' },
	{ name: 'Water 水', cls: 'water' },
];

/** Fixed TCM mapping: organ → five-element. */
export const ORGAN_ELEMENT: Readonly<Record<OrganName, Element>> = {
	Hart: 'fire',
	Long: 'metal',
	Lever: 'wood',
	Galblaas: 'wood',
	Maag: 'earth',
	Milt: 'earth',
	Nier: 'water',
	Blaas: 'water',
};

/** Fixed TCM mapping: organ → tongue zone. */
export const ORGAN_ZONE: Readonly<Record<OrganName, TongueZone>> = {
	Hart: 'tongpunt',
	Long: 'boven-tongpunt',
	Lever: 'linkerrand',
	Galblaas: 'rechterrand',
	Maag: 'centrum',
	Milt: 'centrum',
	Nier: 'wortel-zijkant',
	Blaas: 'wortel-centrum',
};

/** Dutch label for each tongue zone. */
export const ZONE_LABEL: Readonly<Record<TongueZone, string>> = {
	'tongpunt': 'tongpunt',
	'boven-tongpunt': 'gebied boven de tongpunt',
	'linkerrand': 'linkerrand',
	'rechterrand': 'rechterrand',
	'centrum': 'tongcentrum',
	'wortel-zijkant': 'tongwortel (zijkant)',
	'wortel-centrum': 'tongwortel (centrum)',
};

/** All meridians shown in the bar chart. */
export const MERIDIANS = [
	'Lever',
	'Hart',
	'Milt',
	'Long',
	'Nier',
	'Maag',
] as const;

// ── Tongue type definition ──────────────────────────────────────

export interface TongueType {
	readonly id: string;
	readonly name: string;
	readonly nameZh: string;
	readonly color: { readonly label: string; readonly hex: string };
	readonly coating: string;
	readonly shape: string;
	readonly moisture: string;
	readonly symptoms: readonly string[];
	readonly summary: string;
	readonly affectedOrgans: readonly OrganName[];
	readonly qiPatterns: readonly string[];
	readonly advice: readonly string[];
	/** Relative selection weight (1 = normal, <1 = less likely). */
	readonly weight: number;
}

// ── The 10 canonical TCM tongue types ───────────────────────────

export const TONGUE_TYPES: readonly TongueType[] = [
	{
		id: 'normaal',
		name: 'Normaal',
		nameZh: '正常',
		color: { label: 'lichtroze', hex: '#F4A0A0' },
		coating: 'dun wit beslag',
		shape: 'normaal',
		moisture: 'gebalanceerd',
		symptoms: [],
		summary:
			'Uw tong vertoont een opmerkelijk harmonisch patroon. Alle energiestromen zijn in balans — een zeldzame vondst.',
		affectedOrgans: [],
		qiPatterns: [
			'De Qi stroomt vrij door alle meridianen — een teken van diepe harmonie in het lichaam.',
			'Alle vijf elementen zijn in evenwicht, wat duidt op een stabiele constitutie en goede vitaliteit.',
		],
		advice: [
			'Behoud je huidige levensstijl — regelmatige beweging en gevarieerd eten ondersteunen deze balans.',
			'Seizoensgebonden eten helpt om dit evenwicht te bewaren: lichte kost in de zomer, verwarmend in de winter.',
		],
		weight: 0.4,
	},
	{
		id: 'hitte',
		name: 'Hitte',
		nameZh: '热',
		color: { label: 'rood', hex: '#E04040' },
		coating: 'geel beslag',
		shape: 'normaal',
		moisture: 'droog',
		symptoms: ['Warmtegevoel', 'Klam zweterig', 'Dorst', 'Constipatie'],
		summary: 'Overmaat aan interne hitte — het lichaam produceert meer warmte dan het kwijt kan.',
		affectedOrgans: ['Hart', 'Maag', 'Long'],
		qiPatterns: [
			'Hart-Vuur stijgend — onrust of slaapproblemen zijn mogelijk. Bittere thee (zoals chrysantenthee) kan verkoelend werken.',
			'Maag-Hitte — overmatige eetlust, brandend maagzuur of droge ontlasting wijzen op hitte in het spijsverteringskanaal.',
		],
		advice: [
			'Vermijd sterk gekruid, gefriteerd en vet voedsel — deze voeden het interne vuur.',
			'Komkommer, watermeloen en groene thee hebben een verkoelende werking volgens TCM.',
		],
		weight: 1,
	},
	{
		id: 'damp',
		name: 'Damp',
		nameZh: '湿',
		color: { label: 'lichtroze', hex: '#F0B0B0' },
		coating: 'dik wit beslag',
		shape: 'iets vergroot',
		moisture: 'vochtig, kleverig',
		symptoms: [
			'Opgeblazen gevoel',
			'Druk op de borst',
			'Zwaar gevoel',
			'Vermoeidheid',
		],
		summary: 'Vochtigheid (Damp) hoopt zich op in de Milt en Maag — vloeistofcirculatie is verstoord.',
		affectedOrgans: ['Milt', 'Maag'],
		qiPatterns: [
			'Vochtigheid in de Milt — een zwaar, moe gevoel kan duiden op ophoping van vocht. Vermijd zuivel en te veel zoet.',
			'Milt-Qi-deficiëntie — de spijsvertering kan trager werken. Warm, gekookt voedsel heeft de voorkeur boven rauwe maaltijden.',
		],
		advice: [
			'Drink elke ochtend warm water met een schijfje gember om je Milt-Qi te activeren.',
			'Vermijd ijskoude dranken — deze verzwakken het spijsverteringsvuur (Maag-Yang).',
		],
		weight: 1,
	},
	{
		id: 'damp-hitte',
		name: 'Damp-Hitte',
		nameZh: '湿热',
		color: { label: 'rood-oranje', hex: '#E07030' },
		coating: 'vet geel beslag',
		shape: 'iets vergroot, rode randen',
		moisture: 'kleverig',
		symptoms: [
			'Urinewegproblemen',
			'Infecties',
			'Huidklachten',
			'Kort lontje',
		],
		summary: 'Combinatie van Vochtigheid en Hitte — een hardnekkig patroon dat zowel Milt als Blaas belast.',
		affectedOrgans: ['Milt', 'Maag', 'Blaas', 'Lever'],
		qiPatterns: [
			'Damp-Hitte in de onderbuik — blaas- en urinewegklachten kunnen opspelen. Paardenbloem- of beredruifthee wordt traditioneel aanbevolen.',
			'Lever-Galblaas Damp-Hitte — geelzucht, bitterheid in de mond of geïrriteerdheid zijn mogelijke tekenen.',
		],
		advice: [
			'Vermijd alcohol, vette en gefrituurde voeding — deze voeden zowel Damp als Hitte.',
			'Mungbonensoep en gerstewater zijn traditionele TCM-dranken om Damp-Hitte af te voeren.',
		],
		weight: 1,
	},
	{
		id: 'qi-deficient',
		name: 'Qi Deficiënt',
		nameZh: '气虚',
		color: { label: 'bleekroze', hex: '#F0C8C8' },
		coating: 'dun wit beslag',
		shape: 'iets vergroot met tandafdrukken',
		moisture: 'vochtig',
		symptoms: [
			'Kortademig',
			'Vermoeidheid',
			'Slechte eetlust',
			'Spontaan zweten',
		],
		summary: 'Qi-tekort — het lichaam mist voldoende levensenergie, vooral in Milt en Longen.',
		affectedOrgans: ['Milt', 'Long'],
		qiPatterns: [
			'Milt-Qi-deficiëntie — de spijsvertering is verzwakt. Warm, licht verteerbaar voedsel ondersteunt het herstel.',
			'Long-Qi-zwakte — vatbaarheid voor verkoudheid of kortademigheid. Diepe ademhalingsoefeningen worden aanbevolen.',
		],
		advice: [
			'Overweeg acupressuur op punt ST36 (Zusanli) — drie vingerbreedte onder de knie, voor algemene energieversterking.',
			'Eet op vaste tijden en vermijd rauw, koud voedsel — de Milt heeft regelmaat en warmte nodig.',
		],
		weight: 1,
	},
	{
		id: 'qi-stagnatie',
		name: 'Qi Stagnatie',
		nameZh: '气滞',
		color: { label: 'roze met rode tip', hex: '#E8A0A0' },
		coating: 'dun wit beslag',
		shape: 'normaal',
		moisture: 'normaal',
		symptoms: [
			'Gestresst',
			'Kort lontje',
			'Zucht vaak',
			'PMS',
		],
		summary: 'Qi-stagnatie in de Lever — emotionele spanning blokkeert de vrije stroom van energie.',
		affectedOrgans: ['Lever', 'Galblaas'],
		qiPatterns: [
			'Qi-stagnatie in de Lever — emotionele spanning of frustratie kan zich ophopen. Beweging en creatieve expressie worden aanbevolen.',
			'Lever-Qi die de Maag aanvalt — stress beïnvloedt de spijsvertering. Pepermuntthee en rustige maaltijden helpen.',
		],
		advice: [
			'Meditatie of qigong voor 10 minuten per dag kan Qi-stagnatie helpen oplossen.',
			'Eet volgens de seizoenen: groene, licht bittere groenten zijn ideaal voor de Lever.',
		],
		weight: 1,
	},
	{
		id: 'bloed-stagnatie',
		name: 'Bloed Stagnatie',
		nameZh: '血瘀',
		color: { label: 'paarsig', hex: '#A060A0' },
		coating: 'dun wit beslag met paarse/rode puntjes',
		shape: 'normaal',
		moisture: 'normaal',
		symptoms: [
			'Doffe teint',
			'Spataders',
			'Stekende pijn op vaste plekken',
		],
		summary: 'Bloed-stasis — de bloedcirculatie is verstoord, wat kan leiden tot pijn en verkleuring.',
		affectedOrgans: ['Hart', 'Lever'],
		qiPatterns: [
			'Bloed-stasis — de circulatie kan verbetering gebruiken. Kurkuma en lichte beweging ondersteunen de bloedstroom.',
			'Hart-Bloed stasis — pijn op de borst, onregelmatige hartslag of een paarse tint van de lippen zijn mogelijke signalen.',
		],
		advice: [
			'Regelmatige, lichte beweging (wandelen, tai chi) bevordert de bloedcirculatie.',
			'Kurkuma, saffraan en rozenblaadjes worden in TCM traditioneel gebruikt om bloed te bewegen.',
		],
		weight: 1,
	},
	{
		id: 'bloed-deficient',
		name: 'Bloed Deficiënt',
		nameZh: '血虚',
		color: { label: 'bleek', hex: '#F0D0D0' },
		coating: 'dun of weinig beslag',
		shape: 'dun en smal',
		moisture: 'droog-achtig',
		symptoms: [
			'Duizeligheid',
			'Palpitaties',
			'Slecht geheugen',
			'Insomnia',
			'Karige menstruatie',
		],
		summary: 'Bloedtekort — Hart, Lever en Milt produceren of bewaren onvoldoende bloed.',
		affectedOrgans: ['Hart', 'Lever', 'Milt'],
		qiPatterns: [
			'Hart-Bloed deficiëntie — slaapproblemen en vergeetachtigheid kunnen optreden. Longanvruchten en rode dadels worden aanbevolen.',
			'Lever-Bloed tekort — droge ogen, kramp en een bleke teint zijn klassieke signalen. Goji-bessen en donkergroene bladgroenten voeden het Lever-Bloed.',
		],
		advice: [
			'Voeg gojibessen toe aan je thee voor Nier- en Levervoeding.',
			'IJzerrijke voeding (spinazie, linzen, rode bieten) ondersteunt de bloedaanmaak.',
		],
		weight: 1,
	},
	{
		id: 'yin-deficient',
		name: 'Yin Deficiënt',
		nameZh: '阴虚',
		color: { label: 'rood', hex: '#D04040' },
		coating: 'weinig of geen beslag',
		shape: 'kleiner, met scheurtjes',
		moisture: 'droog',
		symptoms: [
			'Nachtzweet',
			'Warme handpalmen en voetzolen',
			'Tinnitus',
			'Droge mond',
		],
		summary: 'Yin-deficiëntie — het verkoelende, voedende aspect van het lichaam is uitgeput.',
		affectedOrgans: ['Nier', 'Lever'],
		qiPatterns: [
			"Nier-Yin-deficiëntie — droogheid en warmte-gevoel, vooral 's avonds. Zwarte sesamzaadjes en walnoten worden traditioneel aanbevolen.",
			'Lever-Yin tekort — droge, geïrriteerde ogen en hoofdpijn aan de slapen. Chrysantenthee en moerbeibessen voeden de Lever-Yin.',
		],
		advice: [
			'Ga voor 23:00 slapen — de Galblaas- en Levermeridiaan zijn dan het meest actief voor herstel.',
			'Peer, zwarte sesam en zeewier zijn Yin-voedend volgens TCM-dieetleer.',
		],
		weight: 1,
	},
	{
		id: 'yang-deficient',
		name: 'Yang Deficiënt',
		nameZh: '阳虚',
		color: { label: 'bleek, licht', hex: '#F0D8D8' },
		coating: 'dik wit beslag',
		shape: 'licht vergroot',
		moisture: 'vochtig',
		symptoms: [
			'Altijd kouwelijk',
			'Wil warmte',
			'Weinig energie',
			'Urineproblemen',
			'Oedeem',
		],
		summary: 'Yang-deficiëntie — het verwarmende, activerende aspect van het lichaam is verzwakt.',
		affectedOrgans: ['Nier', 'Milt'],
		qiPatterns: [
			'Nier-Yang tekort — koude voeten, lage rugpijn en verminderde wilskracht zijn klassieke tekenen. Warm eten en moxatherapie worden aanbevolen.',
			'Milt-Yang deficiëntie — waterige ontlasting en een opgeblazen buik na het eten. Kaneel en gedroogde gember versterken het Yang.',
		],
		advice: [
			'Een warme voetbad voor het slapen stimuleert de Niermeridiaan en bevordert diepe slaap.',
			'Vermijd rauw en koud voedsel — kies voor stoofpotten, soepen en warme kruiden zoals kaneel en kardemom.',
		],
		weight: 1,
	},
];
