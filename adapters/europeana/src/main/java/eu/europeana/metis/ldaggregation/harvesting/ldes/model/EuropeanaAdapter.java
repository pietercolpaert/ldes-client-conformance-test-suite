package eu.europeana.metis.ldaggregation.harvesting.ldes.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.europeana.metis.ldaggregation.harvesting.ldes.ActivityHandler;
import eu.europeana.metis.ldaggregation.harvesting.ldes.TraversalOrderedByTimestamp;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;

import java.io.IOException;
import java.io.PrintStream;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

public final class EuropeanaAdapter implements ActivityHandler {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final PrintStream protocol;
    private final String runId;
    private final Path timestampFile;
    private boolean failed;
    private int emitted;

    private EuropeanaAdapter(PrintStream protocol, String runId, Path stateDirectory) {
        this.protocol = protocol;
        this.runId = runId;
        this.timestampFile = stateDirectory.resolve("last-crawl.txt");
    }

    public static void main(String[] args) throws Exception {
        PrintStream protocol = System.out;
        System.setOut(System.err);
        JsonNode input = JSON.readTree(System.in);
        Path state = Path.of(input.path("stateDirectory").asText());
        Files.createDirectories(state);
        EuropeanaAdapter handler = new EuropeanaAdapter(
                protocol, input.path("runId").asText(), state);
        try {
            new TraversalOrderedByTimestamp(handler)
                    .processStream(input.path("entrypoint").asText());
            if (!handler.failed) {
                handler.emit(event(handler.runId, "statistics",
                        "membersEmitted", handler.emitted));
                handler.emit(event(handler.runId, "run-end",
                        "status", "completed"));
            }
        } catch (Throwable error) {
            handler.error(error);
        }
    }

    @Override
    public boolean isSupportedResourceType(String type) {
        return true;
    }

    @Override
    public void processActivity(Member activity) throws IOException {
        StringWriter dataset = new StringWriter();
        RDFDataMgr.write(dataset, activity.getObjectNamedGraph(), Lang.NTRIPLES);
        emitted++;
        try {
            emit(event(runId, "member",
                    "id", activity.activityRes.getURI(),
                    "dataset", dataset.toString(),
                    "mediaType", "application/n-quads"));
        } catch (Exception exception) {
            throw new IOException(exception);
        }
    }

    @Override
    public void log(String message) {
        System.err.println(message);
    }

    @Override
    public void log(String message, Exception exception) {
        System.err.println(message);
        exception.printStackTrace(System.err);
    }

    @Override
    public Instant getLastCrawlTimestamp(String streamUri) {
        try {
            return Files.exists(timestampFile)
                    ? Instant.parse(Files.readString(timestampFile).trim())
                    : null;
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    @Override
    public void crawlStart(String streamUri) {
        System.err.println("Europeana crawl started: " + streamUri);
    }

    @Override
    public void crawlEnd(Instant latestTimestamp) throws Exception {
        if (latestTimestamp != null) Files.writeString(timestampFile, latestTimestamp.toString());
    }

    @Override
    public void crawlFail(String errorMessage, Exception cause) throws Exception {
        failed = true;
        emit(event(runId, "error",
                "kind", "client",
                "message", errorMessage == null ? cause.toString() : errorMessage));
    }

    private void error(Throwable error) throws Exception {
        if (failed) return;
        failed = true;
        emit(event(runId, "error",
                "kind", "client",
                "message", error.getMessage() == null ? error.toString() : error.getMessage()));
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

    private void emit(Map<String, Object> event) throws Exception {
        protocol.println(JSON.writeValueAsString(event));
        protocol.flush();
    }
}
