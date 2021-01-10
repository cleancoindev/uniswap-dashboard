import React, { useMemo, useEffect } from "react";
import { Line } from "react-chartjs-2";
import { MainLayout } from "../../components/Layout/Main";
import Box from "@material-ui/core/Box";
import Grid from "@material-ui/core/Grid";
import Card from "@material-ui/core/Card";
import { UniswapApolloProvider } from "../../providers/Uniswap/client";
import { useQuery } from "@apollo/client";
import { liquidityPositionHistory } from "../../providers/Uniswap/gql/liquidityPositionHistory";
import { liquidityPositionSnapshots } from "../../providers/Uniswap/gql/liquidityPositionSnapshots";
import { useWeb3Addresses } from "../../providers/Web3";
import CardContent from "@material-ui/core/CardContent";
import Divider from "@material-ui/core/Divider";
import { lighten, useTheme } from "@material-ui/core/styles";
import CardHeader from "@material-ui/core/CardHeader";
import { AddressAvatar, TokenAvatar } from "../../components/Avatar";
import Typography from "@material-ui/core/Typography";
import LinearProgress from "@material-ui/core/LinearProgress";
import Chip from "@material-ui/core/Chip";
import "chart.js";
import { pairsDocument } from "../../providers/Uniswap/gql/pairs";
import Button from "@material-ui/core/Button";
import { makeStyles, createStyles, Theme } from "@material-ui/core/styles";
import { DefaultColorCard } from "../../components/Cards";

// Impermanent Loss Chart
// Initial Liquidity Position (name, timestamp, liquidityTokens, liquidityTokenTotalSupply, reserves0, reserves1)
//  ...
// Current Liquidity Position (name, timestamp, liquidityTokens, liquidityTokenTotalSupply, reserves0, reserves1)

export const Uniswap = () => {
  return (
    <MainLayout>
      <UniswapApolloProvider>
        <Box px={3} pb={5}>
          <Grid container>
            <Grid item xs={12}>
              <UniswapLiquidityProviderHistory />
            </Grid>
          </Grid>
        </Box>
      </UniswapApolloProvider>
    </MainLayout>
  );
};

function pairName(pair: any, invert = false) {
  if (invert) return `${pair?.token1?.symbol}-${pair?.token0?.symbol}`;
  return `${pair?.token0?.symbol}-${pair?.token1?.symbol}`;
}

function fromTimestamp(d: any) {
  if (d instanceof Date) return d;
  if (typeof d === "number") return new Date(d * 1000);
  if (typeof d.timestamp === "number") return new Date(d.timestamp * 1000);
  return new Date();
}

export const UniswapLiquidityProviderHistory = () => {
  const [address] = useWeb3Addresses();
  const variables = useMemo(
    () => (address ? { address: address.toLowerCase() } : {}),
    [address]
  );
  const { data, loading, error } = useQuery(liquidityPositionHistory, {
    variables,
    skip: !address,
  });
  const liquidityPositions = useMemo(
    () => groupBy(data?.liquidityPositionSnapshots, (v: any) => v?.pair?.id),
    [data?.liquidityPositionSnapshots]
  );
  return (
    <>
      {loading ? <LinearProgress /> : null}
      <Box px={2} pt={2} pb={5}>
        {data?.user?.liquidityPositions?.map((position: any) => {
          const storedPositions =
            storedLiquidityPositions?.[data?.user?.id ?? ""]?.[
              position?.pair?.id ?? ""
            ] ?? [];
          const positions = ([] as any[])
            .concat(liquidityPositions[position?.pair?.id ?? ""] ?? [])
            .concat(storedPositions)
            .sort(sortBy("timestamp", -1));
          return (
            <UniswapLiquidityPairHistory
              userId={data?.user?.id}
              pair={position?.pair}
              key={position?.pair?.id}
              positions={positions}
            />
          );
        })}
      </Box>
    </>
  );
};

const UniswapLiquidityPairHistory = ({
  userId,
  pair,
  positions,
}: {
  userId: string;
  pair: any;
  positions: any;
}) => {
  const theme = useTheme();
  const classes = useStyles();
  const query = useQuery(liquidityPositionSnapshots, {
    variables: { pair: pair?.id },
    skip: !pair?.id,
  });

  const {
    data,
    options,
    token0Balance,
    token1Balance,
    token0BalancePrev,
    token1BalancePrev,
  } = useMemo(() => {
    const primary = theme.palette.primary.main;
    const primaryDark = lighten(theme.palette.primary.main, 0.2);
    const secondary = theme.palette.secondary.main;
    const secondaryDark = lighten(theme.palette.secondary.main, 0.2);
    const sorted = query.data?.liquidityPositionSnapshots
      ?.slice(0)
      .sort(sortBy("timestamp"));
    const timestamps = sorted?.map(({ timestamp }: any) => timestamp);
    const enumeratePositions = timestamps?.map((timestamp: number) => {
      const position = positions.find(
        (position: any) => position.timestamp <= timestamp
      );
      return { ...position, timestamp };
    });
    const positionsByTimestamp = keyBy(enumeratePositions, "timestamp");
    const snapshot = sorted?.[sorted?.length - 1];
    const prevSnapshot = sorted?.[sorted?.length - 2];
    const position = positionsByTimestamp?.[snapshot?.timestamp];
    const positionPrev = positionsByTimestamp?.[prevSnapshot?.timestamp];
    const ownership = computeOwnership(snapshot, position);
    const ownershipPrev = computeOwnership(prevSnapshot, positionPrev);
    const token0Balance = Number(snapshot?.reserve0) * ownership;
    const token1Balance = Number(snapshot?.reserve1) * ownership;
    const token0BalancePrev = Number(prevSnapshot?.reserve0) * ownershipPrev;
    const token1BalancePrev = Number(prevSnapshot?.reserve1) * ownershipPrev;
    const data = (sorted ?? []).reduce(
      (acc: any, snapshot: any) => {
        const values = normalizeSnapshot(snapshot);
        const ownership = computeOwnership(
          snapshot,
          positionsByTimestamp?.[snapshot.timestamp]
        );
        const totalReserveUsd0 = values.reserve0 * values.token0PriceUSD;
        const totalReserveUsd1 = values.reserve1 * values.token1PriceUSD;
        const totalOwnershipUsd0 = totalReserveUsd0 * ownership;
        const totalOwnershipUsd1 = totalReserveUsd1 * ownership;
        acc.labels.push(fromTimestamp(snapshot).toDateString());
        acc.datasets[0].data.push(totalReserveUsd0 - totalOwnershipUsd0);
        acc.datasets[1].data.push(totalReserveUsd1 - totalOwnershipUsd1);
        acc.datasets[2].data.push(totalOwnershipUsd0);
        acc.datasets[3].data.push(totalOwnershipUsd1);
        return acc;
      },
      {
        labels: [],
        datasets: [
          {
            label: `${pair?.token0?.symbol} Total Usd`,
            data: [],
            backgroundColor: primary,
            hidden: Boolean(positions?.length),
            pointRadius: 5,
          },
          {
            label: `${pair?.token1?.symbol} Total Usd`,
            data: [],
            backgroundColor: secondary,
            hidden: Boolean(positions?.length),
            pointRadius: 5,
          },
          {
            label: `LP ${pair?.token0?.symbol} Usd`,
            data: [],
            backgroundColor: primaryDark,
            pointRadius: 5,
          },
          {
            label: `LP ${pair?.token1?.symbol} Usd`,
            data: [],
            backgroundColor: secondaryDark,
            pointRadius: 5,
          },
        ],
      }
    );
    const options = {
      ...stacked,
      tooltips: {
        enabled: false,
        mode: "index",
        custom: function (model: any) {
          const tooltipEl = getOrCreateTooltip();
          const tableRoot = tooltipEl.querySelector("table");
          if (model.opacity === 0) {
            tooltipEl.style.opacity = "0";
            return;
          }

          if (!tableRoot) return;
          const { index } = model.dataPoints?.[0] ?? {};
          const snapshot = sorted[index];
          const prevSnapshot = sorted[index - 1];
          if (!snapshot) return;
          const values = normalizeSnapshot(snapshot);
          const ownership = computeOwnership(
            snapshot,
            positionsByTimestamp?.[snapshot.timestamp]
          );
          const totalReserveUsd0 = values.reserve0 * values.token0PriceUSD;
          const totalReserveUsd1 = values.reserve1 * values.token1PriceUSD;
          const totalOwnershipUsd0 = totalReserveUsd0 * ownership;
          const totalOwnershipUsd1 = totalReserveUsd1 * ownership;

          const prevValues = normalizeSnapshot(prevSnapshot);
          const prevOwnership = computeOwnership(
            prevSnapshot,
            positionsByTimestamp?.[prevSnapshot?.timestamp]
          );
          const totalReserveUsd0Prev =
            prevValues.reserve0 * prevValues.token0PriceUSD;
          const totalReserveUsd1Prev =
            prevValues.reserve1 * prevValues.token1PriceUSD;
          const totalOwnershipUsd0Prev = totalReserveUsd0Prev * prevOwnership;
          const totalOwnershipUsd1Prev = totalReserveUsd1Prev * prevOwnership;

          tableRoot.innerHTML = [
            p(b(fromTimestamp(snapshot).toDateString())),
            p(
              `Price ${pair?.token0?.symbol}: ${format(
                values.token0PriceUSD,
                6
              )} ${diff(values.token0PriceUSD, prevValues.token0PriceUSD)}`
            ),
            p(
              `Price ${pair?.token1?.symbol}: ${format(
                values.token1PriceUSD,
                6
              )} ${diff(values.token1PriceUSD, prevValues.token1PriceUSD)}`
            ),
            p(
              `Reserve ${pair?.token0?.symbol}: ${format(
                values.reserve0
              )} ${diff(values.reserve0, prevValues.reserve0)}`
            ),
            p(
              `Reserve ${pair?.token1?.symbol}: ${format(
                values.reserve1
              )} ${diff(values.reserve1, prevValues.reserve1)}`
            ),
            p(
              `LP ${pair?.token0?.symbol}: ${format(
                values.reserve0 * ownership
              )} ${diff(
                values.reserve0 * ownership,
                prevValues.reserve0 * prevOwnership
              )}`
            ),
            p(
              `LP ${pair?.token1?.symbol}: ${format(
                values.reserve1 * ownership
              )} ${diff(
                values.reserve1 * ownership,
                prevValues.reserve1 * prevOwnership
              )}`
            ),
            p(
              `LP ${pair?.token0?.symbol} USD: ${format(
                totalOwnershipUsd0
              )} ${diff(totalOwnershipUsd0, totalOwnershipUsd0Prev)}`
            ),
            p(
              `LP ${pair?.token1?.symbol} USD: ${format(
                totalOwnershipUsd1
              )} ${diff(totalOwnershipUsd1, totalOwnershipUsd1Prev)}`
            ),
          ].join("\n");
          const position = (this as any)._chart.canvas.getBoundingClientRect();
          const size = tableRoot.getBoundingClientRect();
          tooltipEl.classList.add(model.yAlign);
          tooltipEl.style.position = "absolute";
          tooltipEl.style.opacity = "1";
          tooltipEl.style.backgroundColor = model.backgroundColor;
          tooltipEl.style.left =
            Math.min(
              position.left +
                window.pageXOffset +
                model.caretX -
                size.width / 2,
              window.innerWidth - size.width
            ) + "px";
          tooltipEl.style.top =
            position.top + window.pageYOffset + model.caretY + "px";
          tooltipEl.style.fontFamily = model._bodyFontFamily;
          tooltipEl.style.fontSize = model.bodyFontSize + "px";
          tooltipEl.style.fontStyle = model._bodyFontStyle;
          tooltipEl.style.padding =
            model.yPadding + "px " + model.xPadding + "px";
          tooltipEl.style.pointerEvents = "none";
        },
      },
    };
    return {
      data,
      options,
      token0Balance,
      token1Balance,
      token0BalancePrev,
      token1BalancePrev,
    };
  }, [theme, positions, query.data]);
  return (
    <Box mb={4}>
      <Card>
        <CardHeader
          title={pairName(pair)}
          classes={{ action: classes.alignSelfCenter }}
          action={
            <Box
              display="flex"
              flexDirection="row"
              alignItems="flex-end"
              alignSelf="center"
            >
              <Box mr={1}>
                <Button
                  component="a"
                  href={`https://app.uniswap.org/#/swap?inputCurrency=${pair?.token0?.id}&outputCurrency=${pair?.token1?.id}`}
                  rel="noopener"
                  target="_blank"
                  variant="contained"
                  color="secondary"
                >
                  Trade
                </Button>
              </Box>
              <Button
                component="a"
                href={`https://uniswap.info/pair/${pair?.id}`}
                rel="noopener"
                target="_blank"
                variant="contained"
                color="primary"
              >
                Info
              </Button>
            </Box>
          }
        />
        <Divider />
        <CardContent>
          <Grid container spacing={2}>
            <Grid xs={12} md={4} lg={3} item>
              <Box mb={2}>
                <DefaultColorCard>
                  <CardHeader
                    classes={{ action: classes.alignSelfCenter }}
                    title={
                      <Box display="flex" alignItems="center">
                        <TokenAvatar address={pair?.token0?.id} />
                        <Typography style={{ marginLeft: 4 }}>
                          {pair?.token0?.symbol}
                        </Typography>
                      </Box>
                    }
                    // action={
                    //   <Chip
                    //     label={`1 ${pair?.token0?.symbol} = ${format(
                    //       Number(pair?.reserve1 ?? 0) /
                    //         Number(pair?.reserve0 ?? 1),
                    //       6
                    //     )} ${pair?.token1?.symbol}`}
                    //   />
                    // }
                  />
                  <Divider />
                  <CardContent>
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="h4">
                        {token0Balance ? format(token0Balance) : <>&nbsp;</>}
                      </Typography>
                      <Typography variant="h6">
                        <Diff curr={token0Balance} prev={token0BalancePrev} />
                      </Typography>
                    </Box>
                  </CardContent>
                </DefaultColorCard>
              </Box>
              <Box mb={2}>
                <DefaultColorCard>
                  <CardHeader
                    classes={{ action: classes.alignSelfCenter }}
                    title={
                      <Box display="flex" alignItems="center">
                        <TokenAvatar address={pair?.token1?.id} />
                        <Typography style={{ marginLeft: 4 }}>
                          {pair?.token1?.symbol}
                        </Typography>
                      </Box>
                    }
                    // action={
                    //   <Chip
                    //     label={`1 ${pair?.token1?.symbol} = ${format(
                    //       Number(pair?.reserve0 ?? 0) /
                    //         Number(pair?.reserve1 ?? 1),
                    //       6
                    //     )} ${pair?.token0?.symbol}`}
                    //   />
                    // }
                  />
                  <Divider />
                  <CardContent>
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="h4">
                        {token1Balance ? format(token1Balance) : <>&nbsp;</>}
                      </Typography>
                      <Typography variant="h6">
                        <Diff curr={token1Balance} prev={token1BalancePrev} />
                      </Typography>
                    </Box>
                  </CardContent>
                </DefaultColorCard>
              </Box>
              <DefaultColorCard>
                <CardHeader title={<Typography>Pooled Tokens</Typography>} />
                <Divider />
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <TokenAvatar address={pair?.token0?.id} />
                    <Typography style={{ marginLeft: 4 }}>
                      {format(Number(pair?.reserve0 ?? 0))}
                    </Typography>
                    <Typography style={{ marginLeft: 4 }}>
                      {pair?.token0?.symbol}
                    </Typography>
                  </Box>
                  <Box display="flex" alignItems="center">
                    <TokenAvatar address={pair?.token1?.id} />
                    <Typography style={{ marginLeft: 4 }}>
                      {format(Number(pair?.reserve1 ?? 0))}
                    </Typography>
                    <Typography style={{ marginLeft: 4 }}>
                      {pair?.token1?.symbol}
                    </Typography>
                  </Box>
                </CardContent>
              </DefaultColorCard>
            </Grid>
            <Grid xs={12} md={8} lg={9} item>
              <DefaultColorCard>
                <CardContent>
                  <Box height={418} position="relative">
                    <Line data={data} options={options} />
                  </Box>
                </CardContent>
              </DefaultColorCard>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

const storedLiquidityPositions: {
  [address: string]: {
    [pair: string]: {
      timestamp: number;
      liquidityTokenBalance: number;
    }[];
  };
} = {};

try {
  const str = localStorage.getItem("storedLiquidityPositions") || "{}";
  const data = JSON.parse(str);
  Object.keys(data).forEach((address) => {
    storedLiquidityPositions[address] = data[address];
  });
} catch (e) {
  console.log(e);
}

const stacked = {
  height: 400,
  maintainAspectRatio: false,
  scales: {
    yAxes: [
      {
        stacked: true,
        ticks: {
          display: false, // !isMobileDevice()
        },
      },
    ],
    xAxes: [
      {
        ticks: {
          display: false, // !isMobileDevice()
        },
      },
    ],
  },
  onResize: function (chart: any, size: any) {
    const showTicks = false; // (size.height <= 400) ? false : true;
    chart.options = {
      scales: {
        yAxes: [
          {
            stacked: true,
            ticks: {
              display: showTicks,
            },
          },
        ],
        xAxes: [
          {
            ticks: {
              display: showTicks,
            },
          },
        ],
      },
    };
  },
};
const options = {
  scales: {
    yAxes: [
      {
        type: "linear",
        display: true,
        position: "left",
        id: "y-axis-0",
        labels: {
          show: false,
        },
        ticks: {
          beginAtZero: true,
        },
      },
      {
        type: "linear",
        display: true,
        position: "right",
        id: "y-axis-1",
        gridLines: {
          display: false,
        },
        labels: {
          show: false,
        },
        ticks: {
          beginAtZero: true,
        },
      },
    ],
  },
};

const sortBy = (key: string, order = 1) => (a: any, b: any) => {
  return (a[key] - b[key]) * order;
};

const keyBy = (arr: any, key: string) => {
  if (!arr || !arr.reduce) return {};
  return arr.reduce((acc: any, c: any) => {
    acc[c[key]] = c;
    return acc;
  }, {});
};

const format = (n: number, d = 4) =>
  (n ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  });
const normalize = (v: number, min: number, max: number) =>
  (v - min) / (max - min);
const p = (str: string) => `<p>${str}</p>`;
const b = (str: string) => `<b>${str}</b>`;

function diff(curr: number, prev: number) {
  if (typeof curr !== "number") return "";
  if (typeof prev !== "number") return "";
  if (!prev) return "";
  const value = ((curr - prev) / prev) * 100;
  return `<span style="color: ${value >= 0 ? "green" : "red"}"><b>${format(
    value,
    2
  )}%</b></span>`;
}

function Diff({ curr, prev }: { curr: number; prev: number }) {
  if (typeof curr !== "number") return null;
  if (typeof prev !== "number") return null;
  if (!prev) return null;
  const value = ((curr - prev) / prev) * 100;
  return (
    <span style={{ color: value >= 0 ? "green" : "red" }}>
      <b>{format(value, 2)}%</b>
    </span>
  );
}

var getOrCreateTooltip = function () {
  var tooltipEl = document.getElementById("chartjs-tooltip");

  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "chartjs-tooltip";
    tooltipEl.innerHTML = "<table></table>";
    document.body.appendChild(tooltipEl);
  }

  return tooltipEl;
};

function normalizeSnapshot(snapshot: any) {
  const values = {
    reserve0: Number(snapshot?.reserve0),
    reserve1: Number(snapshot?.reserve1),
    token0PriceUSD: Number(snapshot?.token0PriceUSD),
    token1PriceUSD: Number(snapshot?.token1PriceUSD),
  };
  if (!values.token0PriceUSD && values.token1PriceUSD) {
    values.token0PriceUSD =
      (values.reserve1 / values.reserve0) * values.token1PriceUSD;
  }
  if (!values.token1PriceUSD && values.token0PriceUSD) {
    values.token0PriceUSD =
      (values.reserve0 / values.reserve1) * values.token0PriceUSD;
  }
  return values;
}

function computeOwnership(snapshot: any, position: any) {
  const liquidityTokenTotalSupply =
    Number(snapshot?.liquidityTokenTotalSupply) ?? 0;
  const liquidityTokenBalance = Number(position?.liquidityTokenBalance) ?? 0;
  const computedOwnership =
    liquidityTokenTotalSupply && liquidityTokenBalance
      ? Number(liquidityTokenBalance / liquidityTokenTotalSupply) ?? 0
      : 0;
  const ownership =
    Number(position?.liquidityPosition?.poolOwnership ?? 0) ?? 0;
  return Math.max(ownership, computedOwnership);
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    alignSelfCenter: {
      alignSelf: "center",
    },
    alignCenter: {
      display: "flex",
      alignItems: "center",
    },
  })
);

function groupBy<V>(vs: V[], fn: (v: V) => string) {
  return (vs ?? []).reduce((acc, v) => {
    const key = fn(v);
    if (!acc[key]) acc[key] = [];
    acc[key].push(v);
    return acc;
  }, {} as { [key: string]: V[] });
}

export default Uniswap;
