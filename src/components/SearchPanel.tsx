import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Clock, Film, Search, Tv, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { fetchSearchResultsRuntime } from "../lib/runtime-functions";
import {
	forgetRecentSearches,
	readRecentSearches,
	rememberSearch,
	type SearchPerson,
	type SearchResults,
} from "../lib/search";
import { searchSubtitle } from "../lib/search-labels";

type Row =
	| { kind: "item"; key: string; item: MediaItem; section: string }
	| { kind: "person"; key: string; person: SearchPerson; section: string }
	| { kind: "recent"; key: string; query: string; section: string }
	| { kind: "all"; key: string; section: string };

/** How many results of each kind the quick panel shows. */
const QUICK_LIMITS: [keyof SearchResults, number][] = [
	["top", 1],
	["channels", 4],
	["onTv", 3],
	["movies", 4],
	["series", 4],
	["episodes", 3],
	["collections", 2],
	["people", 3],
];

/** Debounce typing so each keystroke doesn't search 60k IPTV titles. */
function useDebounced(value: string, delay: number) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}

export function useSearchResults(query: string) {
	const debounced = useDebounced(query.trim(), 180);
	const result = useQuery({
		queryKey: ["search-results", debounced],
		queryFn: () => fetchSearchResultsRuntime(debounced),
		enabled: debounced.length > 1,
		staleTime: 60_000,
		placeholderData: (previous) => previous,
	});
	return { ...result, debounced, settled: debounced === query.trim() };
}

function Thumb({ item, person }: { item?: MediaItem; person?: SearchPerson }) {
	const [failed, setFailed] = useState(false);
	const src = person
		? person.imageUrl
		: item?.type === "episode"
			? (item.thumbUrl ?? item.backdropUrl ?? item.posterUrl)
			: (item?.posterUrl ?? item?.backdropUrl);
	const channel = item?.type === "channel";
	return (
		<span
			className={`search-thumb${person ? " search-thumb-person" : ""}${channel ? " search-thumb-channel" : ""}${item?.type === "episode" ? " search-thumb-wide" : ""}`}
		>
			{src && !failed ? (
				<img
					src={src}
					alt=""
					loading="lazy"
					referrerPolicy="no-referrer"
					onError={() => setFailed(true)}
				/>
			) : person ? (
				<User size={16} />
			) : channel ? (
				<Tv size={16} />
			) : (
				<Film size={16} />
			)}
		</span>
	);
}

/**
 * The header's search: recent searches while empty, then a ranked mix of
 * Jellyfin and IPTV results with arrow-key navigation, and a way through to
 * the full results page.
 */
export function SearchPanel({ onClose }: { onClose: () => void }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(-1);
	const [recent, setRecent] = useState<string[]>([]);
	const { data, isFetching, debounced, settled } = useSearchResults(query);

	useEffect(() => {
		inputRef.current?.focus();
		setRecent(readRecentSearches());
	}, []);

	const rows = useMemo<Row[]>(() => {
		if (query.trim().length < 2) {
			return recent.map((value) => ({
				kind: "recent",
				key: `recent-${value}`,
				query: value,
				section: "recent",
			}));
		}
		if (!data) return [];
		const out: Row[] = [];
		const shown = new Set<string>();
		for (const [section, limit] of QUICK_LIMITS) {
			if (section === "people") {
				for (const person of data.people.slice(0, limit))
					out.push({ kind: "person", key: `person-${person.id}`, person, section });
				continue;
			}
			let count = 0;
			for (const item of data[section] as MediaItem[]) {
				if (count >= limit) break;
				const key = section === "onTv" ? `tv-${item.id}-${item.airing?.start}` : item.id;
				if (section !== "onTv" && shown.has(key)) continue;
				shown.add(key);
				out.push({ kind: "item", key: `${section}-${key}`, item, section });
				count++;
			}
		}
		out.push({ kind: "all", key: "all", section: "all" });
		return out;
	}, [data, query, recent]);

	useEffect(() => {
		setActive(-1);
	}, [rows]);

	useEffect(() => {
		listRef.current?.querySelector(".search-result-active")?.scrollIntoView({ block: "nearest" });
	}, [active]);

	function openAll(value = query) {
		const text = value.trim();
		if (text.length < 2) return;
		rememberSearch(text);
		onClose();
		void navigate({ to: "/search", search: { q: text } });
	}

	function choose(row: Row) {
		if (row.kind === "recent") {
			setQuery(row.query);
			inputRef.current?.focus();
			return;
		}
		if (row.kind === "all") return openAll();
		rememberSearch(query);
		onClose();
		if (row.kind === "person") {
			void navigate({ to: "/search", search: { person: row.person.id, name: row.person.name } });
			return;
		}
		window.dispatchEvent(new CustomEvent("aurora:select-media", { detail: row.item }));
	}

	const total = data
		? data.channels.length +
			data.onTv.length +
			data.movies.length +
			data.series.length +
			data.episodes.length +
			data.collections.length +
			data.people.length
		: 0;
	const empty = settled && !isFetching && debounced.length > 1 && data && total === 0;

	let lastSection = "";
	return (
		<div
			className="search-shell"
			role="combobox"
			aria-controls="aurora-search-results"
			aria-expanded={rows.length > 0}
			aria-haspopup="listbox"
		>
			<Search size={16} className="search-shell-icon" aria-hidden="true" />
			<input
				ref={inputRef}
				// Opened on purpose, so on a TV the keyboard comes up right away.
				data-tv-keyboard="open"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onClose();
					} else if (event.key === "ArrowDown") {
						event.preventDefault();
						setActive((index) => Math.min(rows.length - 1, index + 1));
					} else if (event.key === "ArrowUp") {
						event.preventDefault();
						setActive((index) => Math.max(-1, index - 1));
					} else if (event.key === "Enter") {
						event.preventDefault();
						const row = rows[active];
						if (row) choose(row);
						else openAll();
					}
				}}
				placeholder={t("search.placeholder")}
				className="search-input"
				aria-label={t("search.placeholder")}
				aria-controls="aurora-search-results"
				aria-activedescendant={active >= 0 ? `search-row-${active}` : undefined}
				enterKeyHint="search"
				autoComplete="off"
				spellCheck={false}
			/>
			{isFetching ? <span className="search-spinner" aria-hidden="true" /> : null}
			<button
				type="button"
				className="icon-button"
				onClick={onClose}
				aria-label={t("search.close")}
			>
				<X size={16} />
			</button>

			{rows.length > 0 || empty ? (
				<div
					className={`search-results${data && data.query !== query.trim() && query.trim().length > 1 ? " search-results-stale" : ""}`}
					id="aurora-search-results"
					role="listbox"
					ref={listRef}
					data-query={data?.query}
				>
					{query.trim().length < 2 && recent.length ? (
						<div className="search-section-head">
							<span>{t("search.recent")}</span>
							<button
								type="button"
								className="search-clear-recent"
								onClick={() => {
									forgetRecentSearches();
									setRecent([]);
									inputRef.current?.focus();
								}}
							>
								{t("search.clearRecent")}
							</button>
						</div>
					) : null}
					{empty ? (
						<p className="search-state">{t("search.emptyFor", { query: debounced })}</p>
					) : null}
					{rows.map((row, index) => {
						const heading =
							row.kind !== "recent" && row.kind !== "all" && row.section !== lastSection
								? t(`search.section.${row.section}`)
								: null;
						if (row.kind !== "recent") lastSection = row.section;
						const className = `search-result${index === active ? " search-result-active" : ""}${row.kind === "all" ? " search-result-all" : ""}`;
						return (
							<div key={row.key}>
								{heading ? <p className="search-section-head">{heading}</p> : null}
								<button
									type="button"
									id={`search-row-${index}`}
									role="option"
									aria-selected={index === active}
									className={className}
									onMouseEnter={() => setActive(index)}
									onClick={() => choose(row)}
								>
									{row.kind === "recent" ? (
										<>
											<span className="search-thumb search-thumb-icon">
												<Clock size={15} />
											</span>
											<span className="search-result-copy">
												<strong>{row.query}</strong>
											</span>
										</>
									) : row.kind === "all" ? (
										<span className="search-result-copy">
											<strong>
												{t("search.allResults", { query: query.trim() })} <ArrowRight size={14} />
											</strong>
										</span>
									) : row.kind === "person" ? (
										<>
											<Thumb person={row.person} />
											<span className="search-result-copy">
												<strong>{row.person.name}</strong>
												<span>{t("search.person")}</span>
											</span>
										</>
									) : (
										<>
											<Thumb item={row.item} />
											<span className="search-result-copy">
												<strong>{row.item.airing ? row.item.airing.title : row.item.title}</strong>
												<span>{searchSubtitle(t, row.item)}</span>
											</span>
										</>
									)}
								</button>
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
