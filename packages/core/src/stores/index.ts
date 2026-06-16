/**
 * Barrel des stores Zustand de @shomee/core.
 *
 * Point d'import unique et stable pour les consommateurs (`@shomee/core/stores`),
 * découplé de l'organisation interne des fichiers. Les 3 stores sont des
 * factories `(getStorage: () => StateStorage) => store` : chaque plateforme
 * injecte son backend (localStorage côté web, AsyncStorage côté mobile).
 *
 * `export *` est sûr ici : les 3 modules n'ont aucune collision de noms
 * (vérifié — createShomeeStore/createSearchStore/createFeedStore + types disjoints).
 *
 * Note : les shims web importent par sous-chemin direct (`@shomee/core/stores/store`
 * via le pattern `./*`), ils ne dépendent PAS de ce barrel et restent inchangés.
 */
export * from './store'
export * from './searchStore'
export * from './feedStore'
