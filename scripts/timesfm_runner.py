"""
TimesFM 2.5 Runner Script
Loads google/timesfm-2.5-200m-pytorch and runs zero-shot forecast on numerical series.
Supports both single-series and batch inference.
"""
import sys
import json
import argparse
import numpy as np

def main():
    parser = argparse.ArgumentParser(description="Run TimesFM 2.5 inference")
    parser.add_argument("--input", type=str, help="Path to input JSON file", required=False)
    parser.add_argument("--horizon", type=int, default=7, help="Forecast horizon")
    parser.add_argument("--repo_id", type=str, default="google/timesfm-2.5-200m-pytorch", help="Hugging Face repo ID")
    args = parser.parse_args()

    try:
        if args.input:
            with open(args.input, "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = json.load(sys.stdin)

        horizon = data.get("horizon", args.horizon)

        # Support single 'series' or multiple 'batch'
        if "batch" in data and isinstance(data["batch"], list):
            series_list = data["batch"]
            is_batch = True
        elif "series" in data and isinstance(data["series"], list):
            series_list = [data["series"]]
            is_batch = False
        else:
            print(json.dumps({
                "success": False,
                "error": "No 'series' or 'batch' field found in input data."
            }))
            sys.exit(1)

        if not series_list:
            print(json.dumps({
                "success": False,
                "error": "Empty input series."
            }))
            sys.exit(1)

        for idx, s in enumerate(series_list):
            if not s or len(s) < 8:
                print(json.dumps({
                    "success": False,
                    "error": f"Series at index {idx} has length {len(s) if s else 0} < 8. Need at least 8 observations."
                }))
                sys.exit(1)

        import timesfm

        # Instantiate model with torch_compile=False for reliable CPU execution on Windows
        model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
            args.repo_id,
            torch_compile=False
        )

        # Max context and horizon configuration
        max_len = max(len(s) for s in series_list)
        # Context must be multiple of patch size (32)
        ctx = ((max_len + 31) // 32) * 32
        ctx = max(ctx, 64)
        hz = ((horizon + 31) // 32) * 32
        hz = max(hz, 32)

        config = timesfm.ForecastConfig(
            max_context=ctx,
            max_horizon=hz,
            normalize_inputs=True
        )
        model.compile(config)

        inputs = [np.array(s, dtype=np.float32) for s in series_list]
        mean_forecast, quantiles = model.forecast(horizon=horizon, inputs=inputs)

        # Convert numpy arrays to native python lists
        # mean_forecast shape: (batch_size, horizon)
        means = mean_forecast.tolist() if hasattr(mean_forecast, 'tolist') else [list(m) for m in mean_forecast]

        quantiles_list = None
        if quantiles is not None and len(quantiles) > 0:
            quantiles_list = quantiles.tolist() if hasattr(quantiles, 'tolist') else [list(q) for q in quantiles]

        if is_batch:
            output = {
                "success": True,
                "horizon": horizon,
                "is_batch": True,
                "batch_size": len(series_list),
                "means": means,
                "quantiles": quantiles_list,
                "input_points": [len(s) for s in series_list]
            }
        else:
            output = {
                "success": True,
                "horizon": horizon,
                "is_batch": False,
                "mean": means[0],
                "quantiles": quantiles_list[0] if quantiles_list else None,
                "input_points": len(series_list[0])
            }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
