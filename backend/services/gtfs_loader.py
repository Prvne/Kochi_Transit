import pandas as pd
import zipfile

def load_stops(gtfs_path="data/KochiTransport.zip"):
    with zipfile.ZipFile(gtfs_path, "r") as z:
        with z.open("stops.txt") as f:
            stops = pd.read_csv(f)
    return stops

def load_all_gtfs(gtfs_path="data/KochiTransport.zip"):
    with zipfile.ZipFile(gtfs_path, "r") as z:
        files = {
            name: pd.read_csv(z.open(name))
            for name in z.namelist()
            if name.endswith(".txt")
        }
    return files
