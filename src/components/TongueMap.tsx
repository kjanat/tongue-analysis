/**
 * Inline SVG tongue organ-zone map based on TCM tongue diagnosis.
 *
 * Zones: Hart (tip), Long (above tip), Lever (L), Galblaas (R),
 *        Milt/Maag (center), Nier (back sides), Blaas (back center).
 */
export default function TongueMap() {
	return (
		<div className='tongue-map-container'>
			<svg
				viewBox='0 0 200 280'
				aria-labelledby='tongue-map-title'
				aria-describedby='tongue-map-desc'
			>
				<title id='tongue-map-title'>TCM Tong-orgaanzone kaart</title>
				<desc id='tongue-map-desc'>
					Een schematische tong opgedeeld in zones die elk een orgaan vertegenwoordigen volgens de Traditionele Chinese
					Geneeskunde. Lever links, Galblaas rechts, Hart aan de punt, Longen daarboven, Milt en Maag in het midden,
					Nieren achterin aan de zijkanten, Blaas centraal achterin.
				</desc>

				{/* Tongue outline */}
				<path
					d='M100 270 C50 270 15 230 15 180 L15 80 C15 30 50 10 100 10 C150 10 185 30 185 80 L185 180 C185 230 150 270 100 270Z'
					fill='#e8a0a0'
					stroke='#b07070'
					strokeWidth='2'
				/>

				{/* ── Zone outlines ────────────────────────────── */}

				{/* Hart — tip */}
				<path
					d='M100 270 C50 270 15 230 15 210 L185 210 C185 230 150 270 100 270Z'
					fill='#e09090'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.6'
				/>
				<text x='100' y='248' textAnchor='middle' fontSize='11' fill='#4a2020' fontWeight='bold'>Hart</text>

				{/* Long — above tip */}
				<path
					d='M15 210 L185 210 L185 175 L15 175Z'
					fill='#e09898'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.5'
				/>
				<text x='100' y='197' textAnchor='middle' fontSize='11' fill='#4a2020' fontWeight='bold'>Longen</text>

				{/* Lever — left */}
				<path
					d='M15 175 L60 175 L60 110 L15 110 C15 110 15 175 15 175Z'
					fill='#d8a898'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.4'
				/>
				<text x='37' y='155' textAnchor='middle' fontSize='10' fill='#4a2020' fontWeight='bold'>Lever</text>

				{/* Galblaas — right */}
				<path
					d='M140 175 L185 175 L185 110 L140 110Z'
					fill='#d8a898'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.4'
				/>
				<text x='163' y='148' textAnchor='middle' fontSize='9' fill='#4a2020' fontWeight='bold'>Gal-</text>
				<text x='163' y='160' textAnchor='middle' fontSize='9' fill='#4a2020' fontWeight='bold'>blaas</text>

				{/* Milt / Maag — center */}
				<path
					d='M60 175 L140 175 L140 110 L60 110Z'
					fill='#e0a8a0'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.45'
				/>
				<text x='100' y='140' textAnchor='middle' fontSize='11' fill='#4a2020' fontWeight='bold'>Milt</text>
				<text x='100' y='155' textAnchor='middle' fontSize='11' fill='#4a2020' fontWeight='bold'>Maag</text>

				{/* Nier — left back */}
				<path
					d='M15 110 L60 110 L60 50 C60 30 50 20 40 20 C30 20 15 30 15 50Z'
					fill='#d0a0a8'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.4'
				/>
				<text x='37' y='78' textAnchor='middle' fontSize='10' fill='#4a2020' fontWeight='bold'>Nier</text>

				{/* Nier — right back */}
				<path
					d='M140 110 L185 110 L185 50 C185 30 170 20 160 20 C150 20 140 30 140 50Z'
					fill='#d0a0a8'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.4'
				/>
				<text x='163' y='78' textAnchor='middle' fontSize='10' fill='#4a2020' fontWeight='bold'>Nier</text>

				{/* Blaas — center back */}
				<path
					d='M60 110 L140 110 L140 50 C140 30 130 15 100 10 C70 15 60 30 60 50Z'
					fill='#d8a0b0'
					stroke='#b07070'
					strokeWidth='1'
					opacity='0.35'
				/>
				<text x='100' y='75' textAnchor='middle' fontSize='11' fill='#4a2020' fontWeight='bold'>Blaas</text>
			</svg>
		</div>
	);
}
