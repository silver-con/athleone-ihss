'use server';

// SELF-SERVICE SIGNUP IS CLOSED (2026-09-17).
//
// Organizations are now created only by a platform admin
// (actions/platform.js's createOrganizationAction), per the three-tier
// model: platform -> organization -> location. The first user of a new
// organization is its ADMIN, created in the same transaction by that
// action.
//
// This file deliberately still exists and still exports signupAction
// rather than being deleted outright. A Server Action is a reachable POST
// endpoint whether or not any page renders it — so the safe way to close
// this path is to keep the export and have it refuse, which also leaves an
// obvious breadcrumb for anyone who goes looking for why /signup is gone.
// createOrganizationWithAdmin in lib/queries.js is untouched: the platform
// action still uses it.
export async function signupAction() {
  return {
    error:
      'Self-service signup is closed. Agency accounts are created by Hearth — ' +
      'contact your Hearth representative to have one set up.',
  };
}
