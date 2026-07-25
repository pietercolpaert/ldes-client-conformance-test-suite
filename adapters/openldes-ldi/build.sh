#!/usr/bin/env bash
set -euo pipefail

client_root="${LDES_CT_OPENLDES_ROOT:-.clients/openldes}"
maven_repo="${LDES_CT_MAVEN_REPO:-$PWD/.cache/maven}"
mvn -B -ntp -f "${client_root}/pom.xml" \
  -Dmaven.repo.local="${maven_repo}" \
  -pl ldi-core/ldes-client/tree-node-supplier -am \
  -Dunittestskip=true \
  -Dintegrationtestskip=true \
  -Dmaven.test.skip=true install
mvn -B -ntp -f adapters/openldes-ldi/pom.xml \
  -Dmaven.repo.local="${maven_repo}" \
  -Dmaven.test.skip=true package
