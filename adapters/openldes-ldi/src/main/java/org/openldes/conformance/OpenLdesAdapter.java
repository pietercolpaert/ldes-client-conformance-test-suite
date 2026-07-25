package org.openldes.conformance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ldes.client.eventstreamproperties.EventStreamPropertiesFetcher;
import ldes.client.eventstreamproperties.valueobjects.EventStreamProperties;
import ldes.client.eventstreamproperties.valueobjects.PropertiesRequest;
import ldes.client.treenodesupplier.TreeNodeProcessor;
import ldes.client.treenodesupplier.domain.valueobject.EndOfLdesException;
import ldes.client.treenodesupplier.domain.valueobject.LdesClientRepositories;
import ldes.client.treenodesupplier.domain.valueobject.LdesMetaData;
import ldes.client.treenodesupplier.domain.valueobject.SuppliedMember;
import ldes.client.treenodesupplier.membersuppliers.MemberSupplier;
import ldes.client.treenodesupplier.membersuppliers.MemberSupplierImpl;
import org.openldes.ldi.HibernateUtil;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.openldes.ldi.requestexecutor.services.RequestExecutorFactory;
import org.openldes.ldi.requestexecutor.executor.RequestExecutor;
import org.openldes.ldi.requestexecutor.valueobjects.Request;
import org.openldes.ldi.requestexecutor.valueobjects.Response;
import org.openldes.ldi.sqlite.SqliteProperties;
import org.openldes.ldi.timestampextractor.TimestampFromCurrentTimeExtractor;

import javax.persistence.EntityManager;
import java.io.PrintStream;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

public final class OpenLdesAdapter {
    private static final ObjectMapper JSON = new ObjectMapper();

    private OpenLdesAdapter() {}

    public static void main(String[] args) throws Exception {
        PrintStream protocol = System.out;
        System.setOut(System.err);
        JsonNode input = JSON.readTree(System.in);
        String runId = input.path("runId").asText();

        try {
            Path stateDirectory = Path.of(input.path("stateDirectory").asText());
            Files.createDirectories(stateDirectory);
            Path workingDirectory = Path.of("").toAbsolutePath();
            String sqliteDirectory = workingDirectory
                    .relativize(stateDirectory.toAbsolutePath())
                    .toString();
            var sqlite = new SqliteProperties(
                    sqliteDirectory, "openldes-client", true);
            EntityManager entityManager = HibernateUtil.createEntityManagerFromProperties(
                    sqlite.getProperties());
            var repositories = LdesClientRepositories.sqlBased(entityManager);
            var metadata = new LdesMetaData(
                    List.of(input.path("entrypoint").asText()),
                    Lang.TURTLE);
            var requestExecutor = new RunBoundedRequestExecutor(
                    new RequestExecutorFactory(false).createNoAuthExecutor());
            var processor = new TreeNodeProcessor(
                    metadata,
                    repositories,
                    requestExecutor,
                    new TimestampFromCurrentTimeExtractor(),
                    status -> {
                        System.err.println("OpenLDES status: " + status);
                        if ("SYNCHRONISING".equals(status.name())) {
                            /*
                             * The runner has already advanced the controlled
                             * fixture phase. Do not spend wall-clock time
                             * waiting for the native next-visit timestamp.
                             */
                            Thread.currentThread().interrupt();
                        }
                    });
            emitContext(protocol, runId, input, requestExecutor);
            MemberSupplier supplier = new MemberSupplierImpl(processor, true);
            supplier.init();
            requestExecutor.beginTraversal();
            int emitted = 0;
            try {
                while (true) {
                    SuppliedMember member = supplier.get();
                    emitted++;
                    StringWriter dataset = new StringWriter();
                    RDFDataMgr.write(dataset, member.getDataset(), Lang.NQUADS);
                    emit(protocol, event(runId, "member",
                            "id", member.getId(),
                            "dataset", dataset.toString(),
                            "mediaType", "application/n-quads"));
                }
            } catch (EndOfLdesException complete) {
                emit(protocol, event(runId, "statistics", "membersEmitted", emitted));
                emit(protocol, event(runId, "run-end", "status", "completed"));
            } catch (SynchronizationComplete complete) {
                emit(protocol, event(runId, "statistics", "membersEmitted", emitted));
                emit(protocol, event(runId, "run-end", "status", "completed"));
            } finally {
                supplier.destroyState();
                entityManager.close();
            }
        } catch (Throwable error) {
            error.printStackTrace(System.err);
            emit(protocol, event(runId, "error",
                    "kind", "client",
                    "message", describe(error)));
        }
    }

    private static void emitContext(
            PrintStream protocol,
            String runId,
            JsonNode input,
            RequestExecutor requestExecutor) throws Exception {
        EventStreamProperties properties = new EventStreamPropertiesFetcher(requestExecutor)
                .fetchEventStreamProperties(new PropertiesRequest(input.path("entrypoint").asText(), Lang.TURTLE));
        StringWriter dataset = new StringWriter();
        RDFDataMgr.write(dataset, properties.getContextDataset(), Lang.NQUADS);
        Map<String, Object> context = event(runId, "context",
                "eventStream", properties.getUri(),
                "rootNode", properties.getRootNode(),
                "shapes", properties.getShaclShapeUris(),
                "viewDescriptions", properties.getViewDescriptions(),
                "retentionPolicies", properties.getRetentionPolicies(),
                "dataset", dataset.toString(),
                "mediaType", "application/n-quads");
        putIfPresent(context, "timestampPath", properties.getTimestampPath());
        putIfPresent(context, "versionOfPath", properties.getVersionOfPath());
        putIfPresent(context, "versionTimestampPath", properties.getVersionTimestampPath());
        putIfPresent(context, "versionSequencePath", properties.getVersionSequencePath());
        putIfPresent(context, "pollingInterval", properties.getPollingInterval());
        emit(protocol, context);
    }

    private static void putIfPresent(Map<String, Object> event, String key, Object value) {
        if (value != null) {
            event.put(key, value);
        }
    }

    private static Map<String, Object> event(
            String runId, String type, Object... properties) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("protocolVersion", 0);
        event.put("type", type);
        event.put("runId", runId);
        for (int index = 0; index < properties.length; index += 2) {
            event.put((String) properties[index], properties[index + 1]);
        }
        return event;
    }

    private static void emit(PrintStream protocol, Map<String, Object> event)
            throws Exception {
        protocol.println(JSON.writeValueAsString(event));
        protocol.flush();
    }

    private static String describe(Throwable error) {
        StringBuilder description = new StringBuilder();
        Throwable current = error;
        while (current != null) {
            if (!description.isEmpty()) description.append(" caused by ");
            description.append(current.getClass().getName()).append(": ")
                    .append(current.getMessage() == null ? "<no message>" : current.getMessage());
            current = current.getCause();
        }
        return description.toString();
    }

    /**
     * The native supplier is a continuous poller. The adapter maps it to one
     * specification synchronization run by allowing every node to be fetched
     * once after initialization and ending the run when polling cycles back to
     * an already visited node.
     */
    private static final class RunBoundedRequestExecutor implements RequestExecutor {
        private final RequestExecutor delegate;
        private final HashSet<String> visited = new HashSet<>();
        private boolean traversalStarted;

        private RunBoundedRequestExecutor(RequestExecutor delegate) {
            this.delegate = delegate;
        }

        private void beginTraversal() {
            visited.clear();
            traversalStarted = true;
        }

        @Override
        public Response execute(Request request) {
            if (traversalStarted && !visited.add(request.getUrl())) {
                throw new SynchronizationComplete();
            }
            return delegate.execute(request);
        }
    }

    private static final class SynchronizationComplete extends RuntimeException {
    }
}
