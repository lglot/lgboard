# Product

## Register

product

## Users

Luigi (single user), software developer. Usa lgboard come home page del browser
per lanciare i servizi self-hosted dell'homelab (lgserver, lgcloud, Mac) e
controllarne lo stato a colpo d'occhio. Contesto: consultazione rapida, decine
di volte al giorno, desktop e mobile.

## Product Purpose

Dashboard homelab self-hosted, zero build step (Python stdlib + React/Babel
runtime, offline). Mostra stats reali dell'host (/proc, /sys, Docker socket),
health-check attivo dei servizi, launcher di app organizzate per categoria.
Estendibile via plugin read-only (es. `automations`). Tutto config-driven da
un singolo `config.json`. Successo = capire lo stato dell'homelab in <5 secondi
e raggiungere qualsiasi servizio in 1 click.

## Brand Personality

Calmo, denso, artigianale. Un tool personale curato, non un prodotto SaaS:
informazione prima di decorazione, ma con dettagli rifiniti (temi, densità,
micro-interazioni sobrie).

## Anti-references

- Dashboard "gamer" (neon, glow, glassmorphism ovunque)
- Grafana-style: niente muri di grafici, lgboard è un launcher con vitali, non
  un sistema di observability
- Template SaaS generici (hero metric, card grid identiche)

## Design Principles

- Stato a colpo d'occhio: ogni dot/badge deve essere leggibile senza aprire nulla
- Config over code: tutto ciò che è personalizzabile vive in config.json
- Zero dipendenze runtime: niente librerie nuove per ciò che CSS/React base coprono
- I plugin ereditano il design system del core (token, tipografia, componenti)

## Accessibility & Inclusion

Utente unico senza esigenze specifiche dichiarate. Baseline comunque rispettata:
contrasto testo ≥4.5:1, focus visibili, Esc chiude i layer, riduzione motion
rispettata (`prefers-reduced-motion`).
