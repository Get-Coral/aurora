import { useId } from "react";

interface AuroraMarkProps {
	width?: number;
	height?: number;
	className?: string;
}

/**
 * The Aurora "Horizon Beam" brand mark: a four-point star split by a glowing
 * light beam. Geometry and colors follow the design handoff exactly; gradient
 * ids are namespaced with useId so multiple marks can render on one page.
 */
export function AuroraMark({ width = 30, height = 22, className }: AuroraMarkProps) {
	const id = useId();
	const star = "M44 3 C46 22 54 30 73 32 C54 34 46 42 44 61 C42 42 34 34 15 32 C34 30 42 22 44 3 Z";

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 88 64"
			width={width}
			height={height}
			className={className}
			aria-hidden="true"
			focusable="false"
		>
			<defs>
				<clipPath id={`${id}-top`}>
					<rect x="0" y="0" width="88" height="29" />
				</clipPath>
				<clipPath id={`${id}-bottom`}>
					<rect x="0" y="35" width="88" height="29" />
				</clipPath>
				<linearGradient
					id={`${id}-fill-top`}
					gradientUnits="userSpaceOnUse"
					x1="15"
					y1="0"
					x2="73"
					y2="0"
				>
					<stop offset="0" stopColor="#fdf2f8" />
					<stop offset="1" stopColor="#f9a8d4" />
				</linearGradient>
				<linearGradient
					id={`${id}-fill-bottom`}
					gradientUnits="userSpaceOnUse"
					x1="15"
					y1="0"
					x2="73"
					y2="0"
				>
					<stop offset="0" stopColor="#a78bfa" />
					<stop offset="1" stopColor="#38bdf8" />
				</linearGradient>
				<linearGradient
					id={`${id}-beam`}
					gradientUnits="userSpaceOnUse"
					x1="4"
					y1="32"
					x2="84"
					y2="32"
				>
					<stop offset="0" stopColor="#f472b6" stopOpacity="0" />
					<stop offset="0.3" stopColor="#f472b6" />
					<stop offset="0.7" stopColor="#38bdf8" />
					<stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
				</linearGradient>
			</defs>
			<path d={star} fill={`url(#${id}-fill-top)`} clipPath={`url(#${id}-top)`} />
			<path
				d={star}
				fill={`url(#${id}-fill-bottom)`}
				clipPath={`url(#${id}-bottom)`}
				opacity="0.8"
			/>
			<line
				x1="4"
				y1="32"
				x2="84"
				y2="32"
				stroke={`url(#${id}-beam)`}
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}
