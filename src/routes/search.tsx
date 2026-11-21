import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clock, Info, Play, Search, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaCard } from "../components/MediaCard";
import { useSearchResults } from "../components/SearchPanel";
import { useFavoriteAction } from "../components/useFavoriteAction";
import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { fetchPersonItemsRuntime } from "../lib/runtime-functions";
import {
	forgetRecentSearches,
	readRecentSearches,
	rememberSearch,
	SEARCH_SECTIONS,
	type SearchPerson,
	type SearchResults,
	type SearchSection,
} from "../lib/search";
import { searchSubtitle } from "../lib/search-labels";

type Filter = "all" | SearchSection;

interface SearchParams {
	q?: string;
	type?: Filter;
	person?: string;
	name?: string;
}

const PREVIEW = 8;

export const Route = createFileRoute("/search")({
	validateSearch: (search: Record<string, unknown>): SearchParams => ({
		q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
		type:
			typeof search.type === "string" && SEARCH_SECTIONS.includes(search.type as SearchSection)
				? (search.type as SearchSection)
				: undefined,
		person: typeof search.person === "string" && search.person ? search.person : undefined,
		name: typeof search.name === "string" && search.name ? search.name : undefined,
	}),
	component: SearchPage,
});

function select(item: MediaItem) {
	window.dispatchEvent(new CustomEvent("aurora:select-media", { detail: item }));
}

function play(item: MediaItem, queue?: MediaItem[]) {
	if (item.type === "series" || item.type === "collection") return select(item);
	window.dispatchEvent(
		new CustomEvent("aurora:play-media", { detail: { item, queue: queue ?? [item] } }),
	);
}

function count(results: SearchResults | undefined, section: SearchSection) {
	return results ? results[section].length : 0;
}

function SearchPage() {
	const { t } = useI18n();
	const navigate = useNavigate({ from: "/search" });
	const { q = "", type = "all", person, name } = Route.useSearch();
	const [query, setQuery] = useState(q);
	const inputRef = useRef<HTMLInputElement>(null);
	const [recent, setRecent] = useState<string[]>([]);
	const { data, isFetching, debounced } = useSearchResults(person ? "" : query);
	const favorite = useFavoriteAction();

	useEffect(() => setRecent(readRecentSearches()), []);
	useEffect(() => setQuery(q), [q]);
	useEffect(() => {
		if (!q && !person) inputRef.current?.focus();
	}, [q, person]);

	// Keep the address in step with what's typed, so results can be shared and
	// survive a reload.
	useEffect(() => {
		if (person || debounced === q.trim()) return;
		void navigate({
			search: (current: SearchParams) => ({ ...current, q: debounced || undefined }),
			replace: true,
		});
		if (debounced.length > 1) rememberSearch(debounced);
	}, [debounced, navigate, person, q]);

	const { data: personItems = [], isLoading: personLoading } = useQuery({
		queryKey: ["person-items", person],
		queryFn: () => fetchPersonItemsRuntime(person as string),
		enabled: Boolean(person),
	});

	function setFilter(next: Filter) {
		void navigate({
			search: (current: SearchParams) => ({ ...current, type: next === "all" ? undefined : next }),
			replace: true,
		});
	}

	function toggleFavorite(item: MediaItem) {
		favorite.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) });
	}

	const results = data;
	const total = SEARCH_SECTIONS.reduce((sum, section) => sum + count(results, section), 0);
	const searching = debounced.length > 1;

	if (person) {
		return (
			<main className="library-shell search-page">
				<div className="page-wrap library-head">
					<div className="library-copy">
						<button
							type="button"
							className="library-backlink"
							onClick={() => window.history.back()}
							data-tv-focusable="true"
						>
							<ArrowLeft size={16} /> {t("search.back")}
						</button>
						<p className="eyebrow">{t("search.person")}</p>
						<h1 className="library-title">{name ?? t("search.person")}</h1>
						<p className="library-summary">
							{personLoading
								? t("search.searching")
								: t("library.totalTitles", { count: personItems.length })}
						</p>
					</div>
				</div>
				<ResultGrid items={personItems} onFavorite={toggleFavorite} />
			</main>
		);
	}

	const filters: Filter[] = [
		"all",
		...SEARCH_SECTIONS.filter((section) => count(results, section) > 0),
	];
	const top = results?.top[0];

	return (
		<main className="library-shell search-page">
			<div className="page-wrap search-hero">
				<label className="search-page-field">
					<Search size={22} aria-hidden="true" />
					<input
						ref={inputRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") setQuery("");
						}}
						placeholder={t("search.pagePlaceholder")}
						aria-label={t("search.placeholder")}
						enterKeyHint="search"
						autoComplete="off"
						spellCheck={false}
					/>
					{isFetching ? <span className="search-spinner" aria-hidden="true" /> : null}
					{query ? (
						<button
							type="button"
							className="icon-button"
							onClick={() => {
								setQuery("");
								inputRef.current?.focus();
							}}
							aria-label={t("search.clear")}
						>
							<X size={18} />
						</button>
					) : null}
				</label>

				{searching && results ? (
					<div className="genre-strip search-filters" role="tablist">
						{filters.map((filter) => (
							<button
								key={filter}
								type="button"
								role="tab"
								aria-selected={type === filter}
								className={`genre-pill${type === filter ? " genre-pill-active" : ""}`}
								onClick={() => setFilter(filter)}
								data-tv-focusable="true"
							>
								{t(filter === "all" ? "search.filter.all" : `search.section.${filter}`)}
								<span className="search-filter-count">
									{filter === "all" ? total : count(results, filter)}
								</span>
							</button>
						))}
					</div>
				) : null}
			</div>

			{!searching ? (
				<div className="page-wrap search-idle">
					{recent.length ? (
						<>
							<div className="search-section-title">
								<h2>{t("search.recent")}</h2>
								<button
									type="button"
									className="search-clear-recent"
									onClick={() => {
										forgetRecentSearches();
										setRecent([]);
									}}
								>
									{t("search.clearRecent")}
								</button>
							</div>
							<div className="genre-strip">
								{recent.map((value) => (
									<button
										key={value}
										type="button"
										className="genre-pill"
										onClick={() => setQuery(value)}
										data-tv-focusable="true"
									>
										<Clock size={14} /> {value}
									</button>
								))}
							</div>
						</>
					) : (
						<p className="library-summary">{t("search.hint")}</p>
					)}
				</div>
			) : results && total === 0 && !isFetching ? (
				<div className="page-wrap">
					<div className="library-empty">
						<p className="eyebrow">{t("search.noResultsEyebrow")}</p>
						<h3>{t("search.emptyFor", { query: debounced })}</h3>
						<p className="library-summary">{t("search.noResultsHint")}</p>
					</div>
				</div>
			) : results ? (
				type === "all" ? (
					<>
						{top ? <TopResult item={top} /> : null}
						{SEARCH_SECTIONS.map((section) =>
							count(results, section) ? (
								<section key={section} className="page-wrap search-section">
									<div className="search-section-title">
										<h2>{t(`search.section.${section}`)}</h2>
										{count(results, section) > PREVIEW ? (
											<button
												type="button"
												className="section-trailing-button section-trailing"
												onClick={() => setFilter(section)}
												data-tv-focusable="true"
											>
												{t("search.showAll", { count: count(results, section) })}
											</button>
										) : null}
									</div>
									{section === "people" ? (
										<PeopleGrid people={results.people.slice(0, PREVIEW)} />
									) : (
										<ResultGrid
											items={(results[section] as MediaItem[]).slice(0, PREVIEW)}
											onFavorite={toggleFavorite}
											embedded
										/>
									)}
								</section>
							) : null,
						)}
					</>
				) : type === "people" ? (
					<div className="page-wrap search-section">
						<PeopleGrid people={results.people} />
					</div>
				) : (
					<ResultGrid items={results[type] as MediaItem[]} onFavorite={toggleFavorite} />
				)
			) : null}
		</main>
	);
}

function TopResult({ item }: { item: MediaItem }) {
	const { t } = useI18n();
	const art = item.backdropUrl ?? item.posterUrl;
	return (
		<section className="page-wrap search-top">
			<div className={`search-top-card${item.type === "channel" ? " search-top-channel" : ""}`}>
				{art ? (
					<img src={art} alt="" className="search-top-art" referrerPolicy="no-referrer" />
				) : null}
				<div className="search-top-copy">
					<p className="eyebrow">{t("search.topResult")}</p>
					<h2>{item.title}</h2>
					<p className="search-top-meta">{searchSubtitle(t, item)}</p>
					{item.overview ? <p className="search-top-overview">{item.overview}</p> : null}
					<div className="dialog-actions">
						<button
							type="button"
							className="primary-action"
							onClick={() => play(item)}
							data-tv-focusable="true"
						>
							<Play size={18} fill="currentColor" />
							{item.type === "channel" ? t("dialog.watchLive") : t("hero.playNow")}
						</button>
						<button
							type="button"
							className="secondary-action"
							onClick={() => select(item)}
							data-tv-focusable="true"
						>
							<Info size={18} /> {t("card.details")}
						</button>
					</div>
				</div>
			</div>
		</section>
	);
}

function ResultGrid({
	items,
	onFavorite,
	embedded = false,
}: {
	items: MediaItem[];
	onFavorite: (item: MediaItem) => void;
	embedded?: boolean;
}) {
	return (
		<div className={`${embedded ? "" : "page-wrap "}library-grid search-grid`}>
			{items.map((item, index) => (
				<MediaCard
					key={`${item.id}-${item.airing?.start ?? ""}`}
					item={item}
					priority={index < 8}
					variant={item.type === "channel" || item.type === "episode" ? "standard" : "poster"}
					onClick={() => select(item)}
					onPlay={(target) =>
						play(
							target,
							items.filter((candidate) => candidate.type === target.type),
						)
					}
					onToggleFavorite={onFavorite}
				/>
			))}
		</div>
	);
}

function PeopleGrid({ people }: { people: SearchPerson[] }) {
	return (
		<div className="search-people">
			{people.map((person) => (
				<Link
					key={person.id}
					to="/search"
					search={{ person: person.id, name: person.name }}
					className="search-person"
					data-tv-focusable="true"
				>
					<span className="search-person-photo">
						{person.imageUrl ? (
							<img src={person.imageUrl} alt="" loading="lazy" />
						) : (
							<User size={28} />
						)}
					</span>
					<strong>{person.name}</strong>
				</Link>
			))}
		</div>
	);
}
