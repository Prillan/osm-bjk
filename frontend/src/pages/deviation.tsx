import { FC } from "react";
import postgrest, { DeviationRow } from "../postgrest.ts";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Anchor, Button, Grid, Loader, Table, Tooltip } from "@mantine/core";
import { Link } from "wouter";
import { actualElementId, actualElementType, getElement } from "../lib/osm.ts";
import _ from "lodash";
import { RFeature, RLayerVector, RMap, ROSM, RStyle } from "rlayers";
import { GeoJSON } from "ol/format";
import { getCenter } from "ol/extent";
import TimeAgo from "../components/TimeAgo.tsx";
import makeLink from "../lib/id.ts";
import Disclaimer from "../components/Disclaimer.tsx";

const TagKeyLink: FC<{ keyString: string }> = (props) => (
  <Anchor href={`https://wiki.openstreetmap.org/wiki/Key:${props.keyString}`} target="_blank">
    {props.keyString}
  </Anchor>
);

const TagValueLink: FC<{ keyString: string; value: string }> = (props) => (
  <>
    {["amenity", "building", "landuse"].includes(props.keyString) ? (
      <Anchor href={`https://wiki.openstreetmap.org/wiki/Tag:${props.keyString}%3D${props.value}`} target="_blank">
        {props.value}
      </Anchor>
    ) : (
      props.value
    )}
  </>
);

const geojson = new GeoJSON();

const Page: FC<{ params: { id: string } }> = ({ params }) => {
  const id = parseInt(params.id);

  const { data: deviationData } = useSuspenseQuery({
    queryKey: ["deviation", id],
    queryFn: async () =>
      await postgrest
        .from("deviation")
        .select(
          "*,osm_geom,upstream_item,dataset(id,name,provider(name),url,license,fetched_at),layer(id,name,description)",
        )
        .eq("id", id)
        .single()
        .throwOnError(),
  });

  const deviation = deviationData.data!;

  const [osm_element_type, osm_element_id] = deviation
    ? [deviation.osm_element_type, deviation.osm_element_id]
    : [null, null];
  const { data: elementData } = useQuery({
    queryKey: ["osm-element", osm_element_type, osm_element_id],
    enabled: !!osm_element_id,
    queryFn: async () => await getElement(osm_element_type!, osm_element_id!),
  });

  const queryClient = useQueryClient();
  const {
    mutate: performAction,
    isPending: isPerformingAction,
    variables,
  } = useMutation({
    mutationFn: async (action: DeviationRow["action"]) =>
      await postgrest.from("deviation").update({ action }).eq("id", deviation.id).throwOnError(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deviation"] });
      queryClient.invalidateQueries({ queryKey: ["osm-element"] });
    },
  });

  const osmGeom = deviation.osm_geom
    ? geojson.readGeometry(deviation.osm_geom).transform("EPSG:3006", "EPSG:3857")
    : undefined;
  const suggestedGeom = deviation.suggested_geom
    ? geojson.readGeometry(deviation.suggested_geom).transform("EPSG:3006", "EPSG:3857")
    : undefined;

  return (
    <Grid grow w="100%" styles={{ inner: { height: "100%" } }}>
      <Grid.Col span={{ base: 12, sm: 6, md: 5, xl: 3 }}>
        <h2 style={{ marginTop: 0 }}>{deviation.title}</h2>
        <p>{deviation.description}</p>

        <Disclaimer />

        <Button.Group w="100%">
          <Button
            fullWidth
            component="a"
            href={makeLink({
              source: `${deviation.dataset!.provider!.name} ${deviation.dataset!.name}`,
              hashtags: ["bastajavlakartan"],
              comment: deviation.title,
              id: deviation.osm_element_id
                ? [
                    actualElementType(deviation.osm_element_type, deviation.osm_element_id),
                    actualElementId(deviation.osm_element_type, deviation.osm_element_id),
                  ]
                : undefined,
              gpx: deviation.suggested_geom
                ? `https://osm.jandal.se/api/rpc/gpx?deviation_id=${deviation.id}`
                : undefined,
            })}
            target="_blank"
          >
            Öppna i iD
          </Button>
          <Tooltip label="Under arbete">
            <Button fullWidth disabled>
              Öppna i JOSM
            </Button>
          </Tooltip>
        </Button.Group>
        <Button.Group w="100%" mt={10}>
          <Button
            fullWidth
            loading={isPerformingAction && variables === "fixed"}
            disabled={isPerformingAction}
            onClick={() => performAction("fixed")}
          >
            Fixad nu
          </Button>
          <Tooltip label="T.ex. om någon annan hunnit åtgärda avvikelsen som inte använt denna sida" withArrow>
            <Button
              fullWidth
              loading={isPerformingAction && variables === "already-fixed"}
              disabled={isPerformingAction}
              onClick={() => performAction("already-fixed")}
            >
              Var redan fixad
            </Button>
          </Tooltip>
        </Button.Group>
        <Button.Group w="100%" mt={2}>
          <Tooltip
            label="T.ex. om felet ligger hos datakällan eller av annan anledning denna avvikelse inte bör åtgärdas i OSM"
            withArrow
            position="bottom"
          >
            <Button
              fullWidth
              loading={isPerformingAction && variables === "not-an-issue"}
              disabled={isPerformingAction}
              onClick={() => performAction("not-an-issue")}
            >
              Inte ett problem
            </Button>
          </Tooltip>
          <Tooltip
            label="T.ex. om korrekt ändring inte kan avgöras än för att det saknas aktuella flygbilder, men att avvikelsen möjligen ska åtgärdas senare"
            withArrow
            position="bottom"
          >
            <Button
              fullWidth
              loading={isPerformingAction && variables === "deferred"}
              disabled={isPerformingAction}
              onClick={() => performAction("deferred")}
            >
              Avvaktas med
            </Button>
          </Tooltip>
        </Button.Group>

        {deviation.action ? (
          <p>
            Markerades som{" "}
            {
              {
                fixed: "fixad",
                "already-fixed": "redan fixad",
                "not-an-issue": "inte ett problem",
                deferred: "avvaktas med",
              }[deviation.action]
            }{" "}
            <TimeAgo date={deviation.action_at!} />
          </p>
        ) : null}

        {deviation.suggested_tags ? (
          <>
            <h3>Föreslagna taggar</h3>
            <Table>
              <Table.Tbody>
                {Object.entries(deviation.suggested_tags).map(([key, value]) => (
                  <Table.Tr key={key}>
                    <Table.Th>
                      <TagKeyLink keyString={key} />
                    </Table.Th>
                    <Table.Td>
                      <TagValueLink keyString={key} value={value} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        ) : null}
        {deviation.osm_element_id ? (
          <>
            <h3>Befintligt element i OSM</h3>
            {!elementData ? (
              <Loader />
            ) : (
              <>
                <Anchor
                  href={`https://openstreetmap.org/${actualElementType(
                    deviation.osm_element_type,
                    deviation.osm_element_id,
                  )}/${actualElementId(deviation.osm_element_type, deviation.osm_element_id)}`}
                >
                  {deviation.osm_element_type}
                  {actualElementId(deviation.osm_element_type, deviation.osm_element_id)}
                </Anchor>
                <br />
                Uppdaterades senast <TimeAgo date={elementData.timestamp} /> av {elementData.user}
                <Table>
                  <Table.Tbody>
                    {Object.entries(elementData.tags || {}).map(([key, value]) => (
                      <Table.Tr key={key}>
                        <Table.Th>
                          <TagKeyLink keyString={key} />
                        </Table.Th>
                        <Table.Td>
                          <TagValueLink keyString={key} value={value} />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}
          </>
        ) : null}

        <h3>Mer information</h3>
        <Table>
          <Table.Tbody>
            <Table.Tr>
              <Table.Th>Källa:</Table.Th>
              <Table.Td>
                <Link to={`/datasets/${deviation.dataset?.id}`}>
                  {deviation.dataset?.name} (från {deviation.dataset?.provider?.name})
                </Link>
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>Senaste hämtning från källa:</Table.Th>
              <Table.Td>
                <TimeAgo date={deviation.dataset!.fetched_at} />
              </Table.Td>
            </Table.Tr>
            {deviation.upstream_item?.updated_at ? (
              <Table.Tr>
                <Table.Th>Källobjekt uppdaterat:</Table.Th>
                <Table.Td>
                  <TimeAgo date={deviation.upstream_item.updated_at} />
                </Table.Td>
              </Table.Tr>
            ) : null}
            {deviation.upstream_item?.url ? (
              <Table.Tr>
                <Table.Th>Länk:</Table.Th>
                <Table.Td>{deviation.upstream_item?.url}</Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 6, md: 7, xl: 9 }}>
        <div
          style={{
            position: "fixed",
            top: "var(--app-shell-header-height)",
            left: "calc(var(--grid-gutter) + (100% - var(--col-flex-basis)))",
            right: 0,
            bottom: 0,
          }}
        >
          <RMap
            width="100%"
            height="100%"
            initial={{
              center: getCenter(geojson.readGeometry(deviation.center).transform("EPSG:3006", "EPSG:3857").getExtent()),
              zoom: 16,
            }}
          >
            <ROSM />
            {osmGeom ? (
              <RLayerVector zIndex={10}>
                <RStyle.RStyle>
                  {osmGeom.getType() === "Point" ? (
                    <RStyle.RCircle radius={8}>
                      <RStyle.RStroke color="blue" width={1} />
                      <RStyle.RFill color="rgb(0 0 128 / 0.2)" />
                    </RStyle.RCircle>
                  ) : (
                    <RStyle.RStroke color="blue" width={1} />
                  )}
                </RStyle.RStyle>
                <RFeature geometry={osmGeom} />
              </RLayerVector>
            ) : null}
            {suggestedGeom ? (
              <RLayerVector zIndex={20}>
                <RStyle.RStyle>
                  {suggestedGeom.getType() === "Point" ? (
                    <RStyle.RCircle radius={8}>
                      <RStyle.RStroke color="green" width={1} />
                      <RStyle.RFill color="rgb(0 128 0 / 0.2)" />
                    </RStyle.RCircle>
                  ) : (
                    <RStyle.RStroke color="green" width={1} />
                  )}
                </RStyle.RStyle>
                <RFeature geometry={suggestedGeom} />
              </RLayerVector>
            ) : null}
          </RMap>
        </div>
      </Grid.Col>
    </Grid>
  );
};
export default Page;
