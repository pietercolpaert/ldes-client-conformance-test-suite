#!/usr/bin/env bash
set -euo pipefail

client_root="${LDES_CT_EUROPEANA_ROOT:-.clients/europeana}"
maven_repo="${LDES_CT_MAVEN_REPO:-$PWD/.cache/maven}"
mvn -B -ntp -f adapters/europeana/pom.xml \
  -Dmaven.repo.local="${maven_repo}" \
  -Dclient.root="$(realpath "${client_root}")" \
  -Dmaven.test.skip=true package
